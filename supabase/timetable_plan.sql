-- Timetable planning: the teaching load (how many weekly lessons of each subject each class has, and with which teacher),
-- the rules of a good teacher timetable, and improvement proposals that wait for approval before they change the timetable.
-- Edited and approved by the superadmin and supervisors; read by the manager.
-- Run this file once in the Supabase SQL Editor, after timetable.sql. It does not change existing data.

alter table public.timetable_config
  add column if not exists quota jsonb not null default '[]'::jsonb,   -- [{ class_name, subject, teacher_id, count }]
  add column if not exists rules jsonb not null default '{}'::jsonb;   -- { run, day, side, gaps: { on, v } }

create table if not exists public.timetable_proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  goal text not null default '',
  teacher_id uuid references public.teachers (id) on delete set null,   -- the teacher whose timetable is improved (empty: everyone)
  changes jsonb not null default '[]'::jsonb,   -- [{ id, from: { d, p }, to: { d, p } }]: lessons moved, with where they were when proposed
  summary jsonb not null default '{}'::jsonb,   -- scores before and after for each affected teacher, for display
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  decided_by text not null default '',
  decided_at timestamptz,
  note text not null default ''
);
create index if not exists timetable_proposals_status_idx on public.timetable_proposals (status, created_at desc);

alter table public.timetable_proposals enable row level security;
revoke all on public.timetable_proposals from anon;
grant select, insert, update, delete on public.timetable_proposals to authenticated;

drop policy if exists timetable_proposals_edit on public.timetable_proposals;
create policy timetable_proposals_edit on public.timetable_proposals
  for all to authenticated
  using (public.my_role() in ('superadmin', 'supervisor'))
  with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists timetable_proposals_manager_read on public.timetable_proposals;
create policy timetable_proposals_manager_read on public.timetable_proposals
  for select to authenticated using (public.my_role() = 'manager');
