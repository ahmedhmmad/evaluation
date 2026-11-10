-- المطالبات المالية (المالية): دفع مبلغ لشخص استُعين به أو اشتُري منه شيء بلا فاتورة.
-- اسم المستفيد، وما أنجزه أو الأصناف المشتراة بمبالغها، والتاريخ، وتُطبع سندًا بتوقيع المستلم ومسلِّم المبلغ والمدير.
-- يُنشئها المدير العام، ويراها المدير. شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  no serial,
  claim_date date not null default current_date,
  payee text not null,                       -- اسم المستفيد (من سيستلم المبلغ)
  payee_id text not null default '',         -- رقم الهوية أو الجوال (اختياري)
  kind text not null default 'service',      -- service: خدمة/عمل أنجزه، purchase: أصناف اشتُريت
  description text not null default '',
  items jsonb not null default '[]',         -- [{item, qty, amount}]
  payer text not null default '',            -- مسلِّم المبلغ
  status text not null default 'pending',    -- pending, paid
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_claims enable row level security;
revoke all on public.payment_claims from anon;
grant select, insert, update, delete on public.payment_claims to authenticated;
grant usage on sequence public.payment_claims_no_seq to authenticated;

drop policy if exists payment_claims_edit on public.payment_claims;
create policy payment_claims_edit on public.payment_claims
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists payment_claims_read on public.payment_claims;
create policy payment_claims_read on public.payment_claims
  for select to authenticated using (public.my_role() = 'manager');
