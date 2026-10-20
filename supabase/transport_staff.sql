-- Transport for staff: a staff member (from the staff list, table teachers) can ride a bus and pay for it.
-- Kept apart from the students' tables, so nothing about students, their dues or their receipts changes.
-- A staff receipt takes its number from the same sequence as the students' receipts (one receipt book).
-- There is no fixed fee for staff: the amount is written on each receipt.
-- A receipt is never edited or deleted from the app; a mistaken one is voided (kept, marked, with the reason)
-- and a new one is issued. Written by the superadmin, read by the manager.
-- Run this file once in the Supabase SQL Editor, after transport.sql (and staff.sql, audit_log.sql if used).
-- It does not change existing data.

create table if not exists public.transport_staff_members (
  staff_id uuid primary key references public.teachers (id) on delete cascade,
  group_id uuid not null references public.transport_groups (id) on delete cascade,
  pickup text not null default '',
  left_from text check (left_from is null or left_from ~ '^\d{4}-\d{2}$'),   -- first cycle not riding; null = riding
  joined_at timestamptz not null default now()
);
create index if not exists transport_staff_members_group_idx on public.transport_staff_members (group_id);

create table if not exists public.transport_staff_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint not null,
  staff_id uuid not null references public.teachers (id) on delete restrict,
  staff_name text not null default '',          -- the name as printed on the receipt
  month text not null check (month ~ '^\d{4}-\d{2}$'),   -- the billing cycle (keyed by the month it starts in)
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  method_note text not null default '',
  paid_on date not null default current_date,
  issued_by text not null default '',
  issued_at timestamptz not null default now(),
  voided_at timestamptz,                         -- set once when the receipt is voided; it then counts nowhere
  voided_by text,
  void_reason text
);
create unique index if not exists transport_staff_payments_receipt_idx on public.transport_staff_payments (receipt_no);
create index if not exists transport_staff_payments_month_idx on public.transport_staff_payments (month, staff_id);
create index if not exists transport_staff_payments_paid_idx on public.transport_staff_payments (paid_on);

-- the same numbering as the students' receipts: one sequence, numbers never repeat
do $$
declare
  seq text := pg_get_serial_sequence('public.transport_payments', 'receipt_no');
begin
  execute format('alter table public.transport_staff_payments alter column receipt_no set default nextval(%L::regclass)', seq);
  execute format('grant usage, select on sequence %s to authenticated', seq);   -- Supabase grants this already; explicit for safety
end $$;

alter table public.transport_staff_members enable row level security;
alter table public.transport_staff_payments enable row level security;
revoke all on public.transport_staff_members, public.transport_staff_payments from anon;
grant select, insert, update, delete on public.transport_staff_members, public.transport_staff_payments to authenticated;

drop policy if exists transport_staff_members_admin on public.transport_staff_members;
create policy transport_staff_members_admin on public.transport_staff_members
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_members_manager_read on public.transport_staff_members;
create policy transport_staff_members_manager_read on public.transport_staff_members
  for select to authenticated using (public.my_role() = 'manager');

drop policy if exists transport_staff_payments_admin on public.transport_staff_payments;
create policy transport_staff_payments_admin on public.transport_staff_payments
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_payments_manager_read on public.transport_staff_payments;
create policy transport_staff_payments_manager_read on public.transport_staff_payments
  for select to authenticated using (public.my_role() = 'manager');

-- An issued staff receipt is never edited or deleted from the app: the only change allowed is voiding it once,
-- with a reason. Work done directly in the SQL Editor (as postgres) is not blocked, for supervised corrections.
create or replace function public.guard_transport_staff_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'لا يُحذف إيصال مسجَّل. ألغِه (يبقى محفوظًا بسبب الإلغاء) ثم أصدر إيصالًا جديدًا.';
  end if;
  -- UPDATE: voiding only
  if old.voided_at is not null then
    raise exception 'هذا الإيصال ملغى ولا يُعدَّل.';
  end if;
  if new.voided_at is null or coalesce(btrim(new.void_reason), '') = ''
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'لا يُعدَّل إيصال مسجَّل. ألغِه مع ذكر السبب ثم أصدر إيصالًا جديدًا.';
  end if;
  return new;
end $$;

drop trigger if exists guard_transport_staff_receipt on public.transport_staff_payments;
create trigger guard_transport_staff_receipt before update or delete on public.transport_staff_payments
  for each row execute function public.guard_transport_staff_receipt();

-- the change log (supabase/audit_log.sql), if it is installed
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.transport_staff_members;
    create trigger audit_row after insert or update or delete on public.transport_staff_members
      for each row execute function public.audit_row('staff_id');
    drop trigger if exists audit_row on public.transport_staff_payments;
    create trigger audit_row after insert or update or delete on public.transport_staff_payments
      for each row execute function public.audit_row('receipt_no');
  end if;
end $$;
