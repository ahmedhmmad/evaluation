-- Buses: each transport group is a bus that follows a route.
-- Adds the driver and capacity of the bus, each student's boarding point, and the payment follow-up:
-- an extra grace date given to a student, and the suspension from riding for a month that was not paid.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

alter table public.transport_groups
  add column if not exists driver_name text,
  add column if not exists driver_phone text,
  add column if not exists capacity integer check (capacity is null or capacity >= 0);

alter table public.transport_members
  add column if not exists pickup text,                 -- where the student boards the bus
  add column if not exists grace_until date,            -- extra time to pay, given to this student
  add column if not exists suspended_month text check (suspended_month is null or suspended_month ~ '^\d{4}-\d{2}$'),  -- month the student is suspended for ("2026-11")
  add column if not exists suspended_by text,
  add column if not exists suspended_at timestamptz;
