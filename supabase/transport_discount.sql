-- Transport receipts with a discount: the receipt is issued for the fee after the discount, with the discount and its reason kept on it.
-- The fee due at issue ("due", receipts_due.sql) is the discounted fee, so a receipt that pays it counts as a FULL payment, not a partial one.
-- Existing receipts are not touched. Run receipts_due.sql first, then this file once in the Supabase SQL Editor.

alter table public.transport_payments
  add column if not exists discount numeric not null default 0,
  add column if not exists discount_reason text not null default '';
