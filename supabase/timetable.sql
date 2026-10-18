-- Timetable: lessons (day × period × class) with their teacher and subject, and the school-day timings.
-- Teachers are the existing staff records (public.teachers); classes are the class names in the class settings.
-- Edited by the superadmin and supervisors; read by the manager; a teacher with an account reads their own lessons.
-- The bell schedule (timings only, no names) is also readable without signing in, for the corridor screen (bells.html).
-- Run this file once in the Supabase SQL Editor, after staff.sql and manager.sql. It does not change existing data.

create table if not exists public.timetable_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,                        -- the lesson's id in the imported file (s88…): a second import updates, never duplicates
  day smallint not null check (day between 0 and 6),        -- 0 = Sunday
  period smallint not null check (period between 1 and 12), -- ordinal; its time comes from the class's stage
  class_name text not null,
  teacher_id uuid references public.teachers (id) on delete set null,
  subject text not null default '',
  status text not null default 'ok' check (status in ('ok', 'review', 'removed')),  -- removed: kept so it can be restored
  note text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists timetable_sessions_class_idx on public.timetable_sessions (class_name, day, period);
create index if not exists timetable_sessions_teacher_idx on public.timetable_sessions (teacher_id, day, period);

-- One row: days, subjects and the bell schedule per stage.
-- bells = { auto, stages: [{ id, name, classes: [class names], rows: [{ k: 'a'|'p'|'b', l, f, t }] }] }
create table if not exists public.timetable_config (
  id int primary key default 1 check (id = 1),
  days jsonb not null default '["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]'::jsonb,
  subjects jsonb not null default '[]'::jsonb,
  bells jsonb not null default '{"auto": true, "stages": []}'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.timetable_config (id) values (1) on conflict (id) do nothing;

alter table public.timetable_sessions enable row level security;
alter table public.timetable_config enable row level security;
revoke all on public.timetable_sessions, public.timetable_config from anon;
grant select, insert, update, delete on public.timetable_sessions, public.timetable_config to authenticated;

drop policy if exists timetable_sessions_edit on public.timetable_sessions;
create policy timetable_sessions_edit on public.timetable_sessions
  for all to authenticated
  using (public.my_role() in ('superadmin', 'supervisor'))
  with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists timetable_sessions_manager_read on public.timetable_sessions;
create policy timetable_sessions_manager_read on public.timetable_sessions
  for select to authenticated using (public.my_role() = 'manager');

drop policy if exists timetable_sessions_own on public.timetable_sessions;
create policy timetable_sessions_own on public.timetable_sessions
  for select to authenticated
  using (public.my_role() = 'teacher' and teacher_id = (select p.teacher_id from public.profiles p where p.id = auth.uid()));

drop policy if exists timetable_config_edit on public.timetable_config;
create policy timetable_config_edit on public.timetable_config
  for all to authenticated
  using (public.my_role() in ('superadmin', 'supervisor'))
  with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists timetable_config_read on public.timetable_config;
create policy timetable_config_read on public.timetable_config
  for select to authenticated using (public.my_role() in ('manager', 'teacher'));

-- The corridor screen: stage names and timings only.
create or replace function public.public_bells()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('days', days, 'bells', bells) from public.timetable_config where id = 1;
$$;
revoke all on function public.public_bells() from public;
grant execute on function public.public_bells() to anon, authenticated;
