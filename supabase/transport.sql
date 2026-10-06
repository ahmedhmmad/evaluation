-- Student transportation: groups by assembly point, their riders, and monthly ride payments.
-- Run this file once in the Supabase SQL Editor, after students.sql.

create table if not exists public.transport_groups (
  id uuid primary key default gen_random_uuid(),
  assembly_point text not null,
  supervisor_name text not null default '',
  supervisor_phone text not null default '',
  pickup_time text not null default '',
  fee numeric not null default 0,               -- each student's monthly share, unless overridden per student
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- A student rides with one group at a time.
create table if not exists public.transport_members (
  student_id uuid primary key references public.students (id) on delete cascade,
  group_id uuid not null references public.transport_groups (id) on delete cascade,
  share numeric,                                -- null = the group's fee
  joined_at timestamptz not null default now()
);
create index if not exists transport_members_group_idx on public.transport_members (group_id);

-- What a student has paid for a given month ("2026-10").
create table if not exists public.transport_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (student_id, month)
);
create index if not exists transport_payments_month_idx on public.transport_payments (month);

alter table public.transport_groups enable row level security;
alter table public.transport_members enable row level security;
alter table public.transport_payments enable row level security;

revoke all on public.transport_groups, public.transport_members, public.transport_payments from anon;
grant select, insert, update, delete on public.transport_groups, public.transport_members, public.transport_payments to authenticated;

-- Like student records: the superadmin only.
drop policy if exists transport_groups_admin on public.transport_groups;
create policy transport_groups_admin on public.transport_groups
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

drop policy if exists transport_members_admin on public.transport_members;
create policy transport_members_admin on public.transport_members
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

drop policy if exists transport_payments_admin on public.transport_payments;
create policy transport_payments_admin on public.transport_payments
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
