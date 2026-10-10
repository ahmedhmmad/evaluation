-- Student registration in two stages: preliminary (from the form) then final (checked at school).
-- Run this file once in the Supabase SQL Editor, after students.sql.

alter table public.students
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'final')),
  add column if not exists finalized_at timestamptz,
  add column if not exists gender text not null default '',
  add column if not exists email text not null default '',
  add column if not exists requested_class text not null default '',     -- the class as written in the form
  add column if not exists form_key text unique,                         -- the form response this record came from
  add column if not exists form_answers jsonb not null default '{}'::jsonb,   -- the answers exactly as the guardian wrote them
  add column if not exists documents jsonb not null default '{}'::jsonb,      -- which documents were handed in
  add column if not exists documents_note text not null default '';

-- Preliminary records come straight from the form, where ID numbers can be missing, mistyped or repeated,
-- so the ID is only required to be unique among finally-registered students.
alter table public.students alter column national_id set default '';
alter table public.students drop constraint if exists students_national_id_key;
create unique index if not exists students_final_national_id
  on public.students (national_id)
  where status = 'final' and national_id <> '';

create index if not exists students_status_idx on public.students (status);

-- Whether the student needs school transport: true, false, or null while not yet asked.
alter table public.students add column if not exists wants_transport boolean;

-- The fuller final-registration file (schooling, guardian, family, health, housing...).
-- These answers are kept together as JSON so fields can be added later without another migration.
alter table public.students add column if not exists details jsonb not null default '{}'::jsonb;
