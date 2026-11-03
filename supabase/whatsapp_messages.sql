-- رسائل واتساب لأولياء الأمور عبر SendWhats: قوالب تُعدَّل من شاشة «رسائل واتساب» في الموقع، وأرشيف بكل رسالة أُرسلت وحالتها.
-- الإرسال نفسه من دالتي send-whatsapp و send-absence-whatsapp (مفتاح SendWhats فيهما لا في الصفحة)، وهما وحدهما تكتبان في الأرشيف.
-- يرى الشاشة ويرسل منها المدير العام والمسجِّل (نفس من يرسل رسائل الغياب).
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.wa_templates (
  key text primary key,                 -- absence و repeat تستعملهما رسائل الغياب؛ والباقي قوالب حرة
  title text not null,
  body text not null,
  sort int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.wa_messages (
  id bigserial primary key,
  batch_id text not null,               -- دفعة الإرسال في SendWhats
  external_id text not null,            -- معرّف الرسالة داخل الدفعة (الطالب، أو رقم ولي الأمر في رسالة الأسرة)
  kind text not null,                   -- مفتاح القالب: absence, repeat, welcome, facebook, urgent ... أو custom
  title text,
  student_ids text[] not null default '{}',
  names text,                           -- أسماء الطلاب المعنيين
  phone text,
  body text not null,
  status text not null default 'queued', -- queued, sending, sent, delivered, read, failed, cancelled, rejected, nophone
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,
  unique (batch_id, external_id)
);
create index if not exists wa_messages_created on public.wa_messages (created_at desc);

alter table public.wa_templates enable row level security;
alter table public.wa_messages enable row level security;
revoke all on public.wa_templates, public.wa_messages from anon;
grant select, insert, update, delete on public.wa_templates to authenticated;
grant select on public.wa_messages to authenticated;
grant usage on sequence public.wa_messages_id_seq to authenticated;

drop policy if exists wa_templates_rw on public.wa_templates;
create policy wa_templates_rw on public.wa_templates for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar'))
  with check (public.my_role() in ('superadmin', 'registrar') and not coalesce(public.my_read_only(), false));

-- الأرشيف للقراءة فقط من الموقع؛ تكتبه دوال الإرسال بمفتاح الخدمة
drop policy if exists wa_messages_read on public.wa_messages;
create policy wa_messages_read on public.wa_messages for select to authenticated
  using (public.my_role() in ('superadmin', 'registrar'));

-- القوالب الأولى. المتغيرات بين أقواس: {الاسم} {الاسم_الأول} {ولي_الأمر} {الشعبة} {التاريخ} {الأكاديمية}
-- ولرسالة تكرار الغياب أيضًا: {العدد} {من} {إلى}
insert into public.wa_templates (key, title, body, sort) values
  ('absence', 'غياب اليوم', E'السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بغياب الطالب/ـة {الاسم} عن المدرسة اليوم {التاريخ}.\nإدارة المدرسة', 1),
  ('repeat', 'تكرار الغياب', E'السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بتكرر غياب الطالب/ـة {الاسم}، إذ غاب {العدد} أيام خلال الفترة من {من} إلى {إلى}.\nنأمل متابعة انتظامه/ـا في الدوام والتواصل مع إدارة المدرسة عند وجود ظرف.\nإدارة المدرسة', 2),
  ('welcome', 'ترحيب بطالب جديد', E'السلام عليكم ورحمة الله وبركاته،\nأهلًا وسهلًا بكم في {الأكاديمية}.\nيسعدنا انضمام {الاسم} إلينا في {الشعبة}، ونتمنى له/لها عامًا موفقًا.\nإدارة الأكاديمية', 3),
  ('facebook', 'متابعة صفحة فيسبوك', E'السلام عليكم ورحمة الله وبركاته،\nندعوكم لمتابعة صفحة {الأكاديمية} على فيسبوك لمعرفة الأخبار والإعلانات أولًا بأول:\n(ضع رابط الصفحة هنا)\nإدارة الأكاديمية', 4),
  ('urgent', 'تنويه عاجل', E'السلام عليكم ورحمة الله وبركاته،\nتنويه عاجل لأولياء أمور طلاب {الأكاديمية}:\n(اكتب التنويه هنا)\nإدارة الأكاديمية', 5)
on conflict (key) do nothing;
