-- Who recorded each transport payment (issued the receipt), and when.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data:
-- payments recorded before it show the time of their last change and no name.

alter table public.transport_payments
  add column if not exists issued_by text not null default '',   -- name of the account that recorded the amount
  add column if not exists issued_at timestamptz;                -- when it was recorded
