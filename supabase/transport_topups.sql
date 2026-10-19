-- Top-up receipts: when a student who paid part of a month pays the rest, that payment gets its own receipt
-- (its own number from the same receipt sequence, its own amount, method and date), instead of raising the first receipt.
-- The month's total stays in transport_payments.amount (raised by the top-up), so every screen and total keeps working;
-- the first receipt keeps its number, date and issuer, and prints its own amount.
-- Like the payments: written by the superadmin, read by the manager. A top-up receipt is never edited; it is deleted
-- only together with a copy in the receipt archive (transport_voided).
-- Run this file once in the Supabase SQL Editor, after transport.sql, receipt_archive.sql and receipts_lock.sql.
-- It does not change existing data: earlier top-ups stay merged into their first receipts, as they were issued.

create table if not exists public.transport_topups (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint not null,
  student_id uuid not null references public.students (id) on delete restrict,
  month text not null,                               -- "2026-10"
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  method_note text not null default '',
  paid_before numeric not null default 0,            -- paid for the month before this receipt
  due numeric,                                       -- the month's fee, as on the first receipt
  paid_on date not null default current_date,
  issued_by text not null default '',
  issued_at timestamptz not null default now()
);
create index if not exists transport_topups_month_idx on public.transport_topups (month, student_id);
create unique index if not exists transport_topups_receipt_idx on public.transport_topups (receipt_no);

-- the same numbering as the first receipts: one sequence, numbers never repeat
do $$
declare
  seq text := pg_get_serial_sequence('public.transport_payments', 'receipt_no');
begin
  execute format('alter table public.transport_topups alter column receipt_no set default nextval(%L::regclass)', seq);
end $$;

alter table public.transport_topups enable row level security;
revoke all on public.transport_topups from anon;
grant select, insert, update, delete on public.transport_topups to authenticated;

drop policy if exists transport_topups_admin on public.transport_topups;
create policy transport_topups_admin on public.transport_topups
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

drop policy if exists transport_topups_manager_read on public.transport_topups;
create policy transport_topups_manager_read on public.transport_topups
  for select to authenticated using (public.my_role() = 'manager');

-- An issued top-up receipt is never edited, and is deleted only with its copy in the archive
create or replace function public.guard_transport_topup()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'لا يُعدَّل إيصال مسجَّل. احذفه إلى أرشيف الإيصالات وأصدر إيصالًا جديدًا.';
  end if;
  if not exists (
    select 1 from public.transport_voided v
    where v.student_id = old.student_id and v.month = old.month and v.receipt_no = old.receipt_no
      and v.voided_at > now() - interval '1 hour'
  ) then
    raise exception 'لا يُحذف إيصال مسجَّل إلا بحذفه إلى أرشيف الإيصالات (بسبب مكتوب).';
  end if;
  return old;
end;
$$;

drop trigger if exists transport_topup_guard on public.transport_topups;
create trigger transport_topup_guard
  before update or delete on public.transport_topups
  for each row execute function public.guard_transport_topup();
