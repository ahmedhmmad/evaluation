-- School committees: a committee has members from the staff (public.teachers) and students (public.students).
-- Edited by the superadmin; read by the manager and the supervisor. Deleting a committee removes its member rows only.
-- Run this file once in the Supabase SQL Editor, after manager.sql and attendance_supervisor.sql. It does not change existing data.

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists committees_name_idx on public.committees (lower(name));

create table if not exists public.committee_members (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees (id) on delete cascade,
  kind text not null check (kind in ('staff', 'student')),
  staff_id uuid references public.teachers (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check ((kind = 'staff' and staff_id is not null and student_id is null) or (kind = 'student' and student_id is not null and staff_id is null)),
  unique (committee_id, staff_id),
  unique (committee_id, student_id)
);
create index if not exists committee_members_committee_idx on public.committee_members (committee_id);

alter table public.committees enable row level security;
alter table public.committee_members enable row level security;
revoke all on public.committees, public.committee_members from anon;
grant select, insert, update, delete on public.committees, public.committee_members to authenticated;

drop policy if exists committees_edit on public.committees;
create policy committees_edit on public.committees
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists committees_read on public.committees;
create policy committees_read on public.committees
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));

drop policy if exists committee_members_edit on public.committee_members;
create policy committee_members_edit on public.committee_members
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists committee_members_read on public.committee_members;
create policy committee_members_read on public.committee_members
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));
