-- Student exit permits (إذن خروج الطلاب أثناء الدوام): who left school, on which day, at what time and why.
-- Edited by the superadmin and the registrar; read by the manager and the supervisor.
-- Run this file once in the Supabase SQL Editor, after registrar.sql, manager.sql and attendance_supervisor.sql. It does not change existing data.

create table if not exists public.student_exits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  day date not null default current_date,
  exit_time time,                      -- ساعة الخروج
  reason text not null default '',     -- سبب الخروج
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists student_exits_day_idx on public.student_exits (day);
create index if not exists student_exits_student_idx on public.student_exits (student_id, day);

alter table public.student_exits enable row level security;
revoke all on public.student_exits from anon;
grant select, insert, update, delete on public.student_exits to authenticated;

drop policy if exists student_exits_edit on public.student_exits;
create policy student_exits_edit on public.student_exits
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_exits_read on public.student_exits;
create policy student_exits_read on public.student_exits
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));
