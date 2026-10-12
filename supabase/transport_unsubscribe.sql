-- Stopping a student's transport subscription from a given month.
-- The student stays in the records of earlier months (with what was paid), and owes nothing from that month on.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

alter table public.transport_members
  add column if not exists left_from text check (left_from is null or left_from ~ '^\d{4}-\d{2}$');   -- first month NOT subscribed ("2026-11"); null = subscribed
