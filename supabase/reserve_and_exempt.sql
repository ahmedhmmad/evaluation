-- 1) "Reserve" registration status (waiting list), beside preliminary and final.
-- 2) Transport fee exemption for a range of months, per student.
-- Run this file once in the Supabase SQL Editor. It does not change existing data.

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('pending', 'reserve', 'final'));

alter table public.transport_members
  add column if not exists exempt_from text check (exempt_from is null or exempt_from ~ '^\d{4}-\d{2}$'),  -- first exempt month ("2026-10")
  add column if not exists exempt_to text check (exempt_to is null or exempt_to ~ '^\d{4}-\d{2}$'),      -- last exempt month; null = until changed
  add column if not exists exempt_note text not null default '';
