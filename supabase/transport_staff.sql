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

-- ===== Refunds to staff =====
-- Money given back to a staff member from what they paid for a cycle. The receipt itself is never changed:
-- the refund is its own record (with a voucher number from the same book as the students' refunds when
-- transport_refunds.sql is installed), and the cycle's net is the receipts minus the refunds.
-- A refund is never edited or deleted from the app. Safe to re-run.
create table if not exists public.transport_staff_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no bigint,
  staff_id uuid not null references public.teachers (id) on delete restrict,
  staff_name text not null default '',
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  receipt_no bigint,                                   -- the latest receipt the money was paid with
  paid_before numeric not null default 0,              -- net paid for the cycle before this refund
  amount numeric not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'instapay', 'vodafone', 'other')),
  method_note text not null default '',
  reason text not null check (btrim(reason) <> ''),
  refunded_by text not null default '',
  refunded_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transport_staff_refunds_month_idx on public.transport_staff_refunds (month, staff_id);

do $$
declare
  seq text := case when to_regclass('public.transport_refunds') is not null
                   then pg_get_serial_sequence('public.transport_refunds', 'refund_no') end;
begin
  if seq is null then
    create sequence if not exists public.transport_staff_refunds_no_seq;
    seq := 'public.transport_staff_refunds_no_seq';
  end if;
  execute format('alter table public.transport_staff_refunds alter column refund_no set default nextval(%L::regclass)', seq);
  execute format('grant usage, select on sequence %s to authenticated', seq);
end $$;
create unique index if not exists transport_staff_refunds_no_idx on public.transport_staff_refunds (refund_no);

alter table public.transport_staff_refunds enable row level security;
revoke all on public.transport_staff_refunds from anon;
grant select, insert, update, delete on public.transport_staff_refunds to authenticated;
drop policy if exists transport_staff_refunds_admin on public.transport_staff_refunds;
create policy transport_staff_refunds_admin on public.transport_staff_refunds
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_refunds_manager_read on public.transport_staff_refunds;
create policy transport_staff_refunds_manager_read on public.transport_staff_refunds
  for select to authenticated using (public.my_role() = 'manager');

-- net paid for a staff member's cycle: valid receipts minus refunds
create or replace function public.staff_transport_net(p_staff uuid, p_month text)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce((select sum(amount) from public.transport_staff_payments
                    where staff_id = p_staff and month = p_month and voided_at is null), 0)
       - coalesce((select sum(amount) from public.transport_staff_refunds
                    where staff_id = p_staff and month = p_month), 0)
$$;

-- a refund cannot exceed what is left of the cycle's payments, and is never edited or deleted
create or replace function public.guard_transport_staff_refund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('staff_refund:' || new.staff_id || ':' || new.month));
    if new.amount > public.staff_transport_net(new.staff_id, new.month) then
      raise exception 'المبلغ المسترد أكبر من صافي ما دفعه الموظف عن هذه الدورة.';
    end if;
    return new;
  end if;
  raise exception 'لا يُعدَّل سند استرداد مسجَّل ولا يُحذف.';
end $$;

drop trigger if exists guard_transport_staff_refund on public.transport_staff_refunds;
create trigger guard_transport_staff_refund before insert or update or delete on public.transport_staff_refunds
  for each row execute function public.guard_transport_staff_refund();

-- voiding a receipt must not leave the cycle refunded more than was paid
create or replace function public.guard_transport_staff_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and public.staff_transport_net(new.staff_id, new.month) < 0 then
    raise exception 'استُرد من هذه الدورة مبلغ لا يبقى له غطاء إن أُلغي هذا الإيصال.';
  end if;
  return new;
end $$;

drop trigger if exists guard_transport_staff_void on public.transport_staff_payments;
create trigger guard_transport_staff_void after update on public.transport_staff_payments
  for each row execute function public.guard_transport_staff_void();

do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.transport_staff_refunds;
    create trigger audit_row after insert or update or delete on public.transport_staff_refunds
      for each row execute function public.audit_row('refund_no');
  end if;
end $$;
