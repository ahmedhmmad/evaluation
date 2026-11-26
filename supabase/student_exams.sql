-- الاختبارات (شاشة «الاختبارات»): اختبار له عنوان (مثل «اختبار دورة القراءة العربية») وتاريخ، وطلاب مختارون من أي صف،
-- وأعضاء لجنة، ودرجة لكل طالب. يعدّلها المدير العام والمسجِّل، ويراها المدير والمشرف.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.student_exams (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'اختبار دورة القراءة العربية',
  exam_date date not null default current_date,
  subject text not null default '',              -- مادة الاختبار في جدول الحصص (منها يُعرف مدرس كل طالب)
  committee text[] not null default '{}',        -- أسماء أعضاء لجنة الاختبار
  student_ids uuid[] not null default '{}',
  grades jsonb not null default '{}'::jsonb,     -- { معرّف الطالب: الدرجة }
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_exams enable row level security;
revoke all on public.student_exams from anon;
grant select, insert, update, delete on public.student_exams to authenticated;

drop policy if exists student_exams_edit on public.student_exams;
create policy student_exams_edit on public.student_exams
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_exams_read on public.student_exams;
create policy student_exams_read on public.student_exams
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));
