-- Archive of deleted (voided) transport receipts.
-- Deleting a receipt removes the payment, so the student owes that month again,
-- while a copy of the receipt is kept here with who deleted it, when and why.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

create table if not exists public.transport_voided (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint,                              -- the number the receipt carried
  student_id uuid references public.students (id) on delete set null,
  student_name text not null default '',          -- kept as text so the record survives changes to the student
  class_name text not null default '',
  assembly_point text not null default '',
  month text not null,                            -- "2026-10"
  amount numeric not null default 0,
  method text not null default 'cash',
  method_note text not null default '',
  paid_on date,
  reason text not null default '',
  voided_by text not null default '',
  voided_at timestamptz not null default now()
);
create index if not exists transport_voided_at_idx on public.transport_voided (voided_at desc);

alter table public.transport_voided enable row level security;
revoke all on public.transport_voided from anon;
grant select, insert, update, delete on public.transport_voided to authenticated;

-- Like the payments themselves: the superadmin only.
drop policy if exists transport_voided_admin on public.transport_voided;
create policy transport_voided_admin on public.transport_voided
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
