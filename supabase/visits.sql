-- Supervisory visit reports (تقرير زيارة إشرافية صفية).
-- Run this file once in the Supabase SQL Editor, after schema.sql.

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  visit_date date not null default current_date,
  subject text not null default '',
  class_section text not null default '',
  period text not null default '',
  lesson_title text not null default '',
  visit_number int not null default 1,
  strengths jsonb not null default '{}'::jsonb,   -- one text per evaluation domain, keyed "0".."6"
  development text not null default '',
  recommendations text not null default '',
  supervisor_name text not null default '',
  principal_name text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists visits_teacher_idx on public.visits (teacher_id, visit_date desc);

-- Statements added by users to the suggestion lists.
-- field is "d0".."d6" (a domain's strengths), "development" or "recommendations".
create table if not exists public.statements (
  id uuid primary key default gen_random_uuid(),
  field text not null,
  body text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (field, body)
);

alter table public.visits enable row level security;
alter table public.statements enable row level security;

revoke all on public.visits, public.statements from anon;
grant select, insert, update, delete on public.visits to authenticated;
grant select, insert, delete on public.statements to authenticated;

-- Supervisors and the superadmin only; viewers have no access to visit reports.
drop policy if exists visits_staff on public.visits;
create policy visits_staff on public.visits
  for all to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));

drop policy if exists statements_staff on public.statements;
create policy statements_staff on public.statements
  for all to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));
