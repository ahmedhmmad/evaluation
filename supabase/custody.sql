-- Custody (عهد): items the academy holds, with their quantity and notes.
-- Edited by the superadmin; read by the manager.
-- Run this file once in the Supabase SQL Editor, after manager.sql. It does not change existing data.

create table if not exists public.custody_items (
  id uuid primary key default gen_random_uuid(),
  item text not null,
  qty integer not null default 1 check (qty >= 0),
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custody_items enable row level security;
revoke all on public.custody_items from anon;
grant select, insert, update, delete on public.custody_items to authenticated;

drop policy if exists custody_edit on public.custody_items;
create policy custody_edit on public.custody_items
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists custody_read on public.custody_items;
create policy custody_read on public.custody_items
  for select to authenticated using (public.my_role() = 'manager');
