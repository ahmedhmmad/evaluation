-- الطلبيات (خطابات طلب احتياجات للجهات الداعمة): المرسَل إليه، والموضوع، وجدول الأصناف بوحداتها وكمياتها، وتُطبع خطابًا رسميًا.
-- يُنشئها ويعدّلها المدير العام، ويراها المدير. شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  no serial,
  order_date date not null default current_date,
  recipient text not null default '',      -- السادة / جمعية ...
  recipient2 text not null default '',     -- سطر ثانٍ تحت اسم الجهة
  subject text not null default 'طلب احتياجات مدرسية',
  intro text not null default '',
  items jsonb not null default '[]',       -- [{item, unit, qty}]
  closing text not null default '',
  status text not null default 'draft',    -- draft, sent, received
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;
revoke all on public.orders from anon;
grant select, insert, update, delete on public.orders to authenticated;
grant usage on sequence public.orders_no_seq to authenticated;

drop policy if exists orders_edit on public.orders;
create policy orders_edit on public.orders
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated using (public.my_role() = 'manager');
