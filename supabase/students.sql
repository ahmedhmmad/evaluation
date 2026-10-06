-- Student registration.
-- Run this file once in the Supabase SQL Editor, after the other scripts.

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  national_id text not null unique,
  phone text not null default '',
  whatsapp text not null default '',
  birth_date date,
  address text not null default '',
  class_name text not null default '',          -- one of the school's classes (settings.classes); '' = not assigned yet
  has_prev_certificate boolean,
  prev_grade text not null default '',
  guardian_name text not null default '',
  guardian_relation text not null default '',
  guardian_job text not null default '',
  has_health_condition boolean,
  takes_medication boolean,
  has_special_needs boolean,
  is_orphan boolean,
  orphan_of text not null default '',
  memorizes_quran boolean,
  quran_parts numeric,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists students_class_idx on public.students (class_name);

alter table public.students enable row level security;
revoke all on public.students from anon;
grant select, insert, update, delete on public.students to authenticated;

-- Student records hold personal and health information: the superadmin only.
drop policy if exists students_admin on public.students;
create policy students_admin on public.students
  for all to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');
