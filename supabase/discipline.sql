-- Discipline register (سجل المخالفات / سجل الضبط): a student's violations and warnings with the date, the violation and the action taken.
-- Edited by the superadmin and the registrar; read by the manager and the supervisor.
-- Run this file once in the Supabase SQL Editor, after registrar.sql, manager.sql and attendance_supervisor.sql. It does not change existing data.

create table if not exists public.discipline_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  day date not null default current_date,
  kind text not null default 'violation' check (kind in ('violation', 'warning')),   -- مخالفة أو إنذار
  violation text not null default '',
  action text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists discipline_records_student_idx on public.discipline_records (student_id, day);
create index if not exists discipline_records_day_idx on public.discipline_records (day);

alter table public.discipline_records enable row level security;
revoke all on public.discipline_records from anon;
grant select, insert, update, delete on public.discipline_records to authenticated;

drop policy if exists discipline_edit on public.discipline_records;
create policy discipline_edit on public.discipline_records
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists discipline_read on public.discipline_records;
create policy discipline_read on public.discipline_records
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));
