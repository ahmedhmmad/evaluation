-- قوائم الطلاب العامة (شئون الطلاب): قائمة لها عنوان (مثل «الموافقون على تطعيم الحصبة») ويُختار فيها طلاب،
-- وتُطبع كشفًا حسب الشعبة للمختارين أو لغير المختارين. تُستعمل لأي غرض: تطعيم، رحلة، نشاط، استلام كتب...
-- يعدّلها المدير العام والمسجِّل، ويراها المدير والمشرف. شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.student_lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  yes_label text not null default 'وافق',       -- وصف المختارين في الكشف المطبوع
  no_label text not null default 'لم يوافق',    -- وصف غير المختارين
  notes text not null default '',
  student_ids uuid[] not null default '{}',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_lists enable row level security;
revoke all on public.student_lists from anon;
grant select, insert, update, delete on public.student_lists to authenticated;

drop policy if exists student_lists_edit on public.student_lists;
create policy student_lists_edit on public.student_lists
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_lists_read on public.student_lists;
create policy student_lists_read on public.student_lists
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));
