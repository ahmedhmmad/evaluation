-- Daily attendance: one row per student per school day, written when a class's attendance is taken.
-- Read and written by the superadmin and registrars (the people who can see student records).
-- Run this file once in the Supabase SQL Editor, after students.sql and registrar.sql. It does not change existing data.

create table if not exists public.attendance (
  student_id uuid not null references public.students (id) on delete cascade,
  day date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  note text not null default '',
  class_name text not null default '',          -- the class the student was in that day (reports by class keep working after a move)
  recorded_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, day)
);
create index if not exists attendance_day_idx on public.attendance (day);
create index if not exists attendance_class_day_idx on public.attendance (class_name, day);

alter table public.attendance enable row level security;
revoke all on public.attendance from anon;
grant select, insert, update, delete on public.attendance to authenticated;

drop policy if exists attendance_staff on public.attendance;
create policy attendance_staff on public.attendance
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar'))
  with check (public.my_role() in ('superadmin', 'registrar'));
