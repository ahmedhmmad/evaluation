-- Issued receipts are locked in the database itself, not only on the page.
-- A transport payment row with an amount is a receipt. From the app (any account, the superadmin included):
--   * its number, month, payment method and payment reference never change;
--   * its amount may only go up (a top-up for the rest of the month's fee, same method);
--   * it goes down only through a refund recorded in transport_refunds a moment before;
--   * it is deleted only after a copy was saved to the archive (transport_voided) or it was refunded in full;
--   * it moves to another student record only when both records carry the same national ID (merging a duplicate).
-- Work done directly in the Supabase SQL Editor (as postgres) is not blocked, for supervised corrections.
-- Run this file once in the Supabase SQL Editor, after transport.sql, transport_refunds.sql and receipt_archive.sql.
-- It does not change existing data.

create or replace function public.guard_transport_receipt()
returns trigger
language plpgsql
-- not security definer: current_user must stay the caller, to tell the app (authenticated) from the SQL Editor (postgres)
set search_path = public
as $$
declare
  ok boolean;
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.amount, 0) <= 0 then
      return new; -- not a receipt yet
    end if;
    if new.receipt_no is distinct from old.receipt_no or new.month <> old.month
       or coalesce(new.method, '') <> coalesce(old.method, '')
       or coalesce(new.method_note, '') <> coalesce(old.method_note, '') then
      raise exception 'لا يُعدَّل إيصال مسجَّل (رقمه أو شهره أو وسيلة الدفع أو رقم الدفع). احذفه إلى أرشيف الإيصالات وأصدر إيصالًا جديدًا.';
    end if;
    if new.student_id <> old.student_id then
      select exists (
        select 1 from public.students a join public.students b on b.national_id = a.national_id
        where a.id = old.student_id and b.id = new.student_id and coalesce(a.national_id, '') <> ''
      ) into ok;
      if not ok then
        raise exception 'لا يُنقل إيصال إلى طالب آخر.';
      end if;
    end if;
    if new.amount < old.amount then
      select exists (
        select 1 from public.transport_refunds r
        where r.student_id = old.student_id and r.month = old.month
          and r.paid_before = old.amount and r.amount = old.amount - new.amount
          and r.created_at > now() - interval '15 minutes'
      ) into ok;
      if not ok then
        raise exception 'لا يُخفَّض مبلغ إيصال مسجَّل إلا بالاسترداد.';
      end if;
    end if;
    return new;
  end if;

  -- DELETE
  if coalesce(old.amount, 0) > 0 then
    select exists (
      select 1 from public.transport_voided v
      where v.student_id = old.student_id and v.month = old.month
        and v.receipt_no is not distinct from old.receipt_no and v.voided_at > now() - interval '1 hour'
    ) or exists (
      select 1 from public.transport_refunds r
      where r.student_id = old.student_id and r.month = old.month
        and r.paid_before = old.amount and r.amount = old.amount
        and r.created_at > now() - interval '15 minutes'
    ) into ok;
    if not ok then
      raise exception 'لا يُحذف إيصال مسجَّل إلا بحذفه إلى أرشيف الإيصالات (بسبب مكتوب) أو باسترداده كاملًا.';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists transport_receipt_guard on public.transport_payments;
create trigger transport_receipt_guard
  before update or delete on public.transport_payments
  for each row execute function public.guard_transport_receipt();
