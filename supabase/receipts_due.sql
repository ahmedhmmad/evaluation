-- The fee due at the moment a receipt is issued is kept with the receipt ("due").
-- From then on that month's fee for that student is what the receipt says, whatever happens later in the
-- family (another sibling paying, a sibling stopping): issued receipts are never re-priced.
-- Receipts issued before this file have no "due" and keep being computed as before.
-- Run this file once in the Supabase SQL Editor. It does not change existing data.

alter table public.transport_payments
  add column if not exists due numeric;
