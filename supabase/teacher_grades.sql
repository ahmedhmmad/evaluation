-- صفوف المعلم ودرجات الطلاب.
-- 1) my_classes / my_students: يرى المعلم (بحسابه) بيانات طلاب الشعب التي يدرّسها في جدول الحصص فقط:
--    الاسم، والشعبة، وتاريخ الميلاد، والسكن، وجوال الطالب، وجوال ولي الأمر، والجوال البديل.
-- 2) grade_items: إعداد الدرجات من الإدارة (المدير العام): لكل فصل دراسي اختباراته ودرجة كلٍّ منها (اختبار أكتوبر 10، نصف الفصل 30…).
-- 3) grades: يرصد المعلم درجات طلابه في مواده هو فقط؛ والمدير العام والمدير يرون الكل، والمدير العام يعدّل.
-- شغّل هذا الملف مرة في محرر SQL في Supabase، بعد timetable.sql و teacher_papers.sql. لا يغيّر أي بيانات موجودة.

create or replace function public.my_classes() returns table (class_name text, subject text)
language sql stable security definer set search_path = public as $$
  select distinct s.class_name, s.subject from timetable_sessions s
  where s.teacher_id = public.my_teacher_id() and s.status <> 'removed' and s.class_name <> ''
  order by 1, 2
$$;
grant execute on function public.my_classes() to authenticated;

create or replace function public.my_students() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'full_name', x.full_name, 'class_name', x.class_name, 'birth_date', x.birth_date, 'gender', x.gender,
      'address', x.address, 'city', x.details ->> 'city', 'neighborhood', x.details ->> 'neighborhood',
      'student_phone', coalesce(nullif(x.details ->> 'student_phone', ''), x.whatsapp), 'guardian_name', x.guardian_name,
      'phone', x.phone, 'alt_phone', x.details ->> 'alt_phone') order by x.class_name, x.full_name), '[]'::jsonb)
  from students x
  where x.status in ('final', 'reserve')
    and x.class_name in (select c.class_name from public.my_classes() c)
$$;
grant execute on function public.my_students() to authenticated;

create table if not exists public.grade_items (
  id uuid primary key default gen_random_uuid(),
  term text not null default 'الفصل الدراسي الأول',
  name text not null,
  max_score numeric not null check (max_score > 0),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.grade_items enable row level security;
revoke all on public.grade_items from anon;
grant select, insert, update, delete on public.grade_items to authenticated;
drop policy if exists grade_items_read on public.grade_items;
create policy grade_items_read on public.grade_items for select to authenticated using (coalesce(public.my_role(), 'pending') <> 'pending');
drop policy if exists grade_items_edit on public.grade_items;
create policy grade_items_edit on public.grade_items for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

create table if not exists public.grades (
  student_id uuid not null references public.students (id) on delete cascade,
  item_id uuid not null references public.grade_items (id) on delete cascade,
  subject text not null,
  score numeric,
  teacher_id uuid,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, item_id, subject)
);
alter table public.grades enable row level security;
revoke all on public.grades from anon;
grant select, insert, update, delete on public.grades to authenticated;

-- المعلم: طلاب شعبه في مواده هو
create or replace function public.grade_mine(p_student uuid, p_subject text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students x join timetable_sessions s on s.class_name = x.class_name
    where x.id = p_student and s.subject = p_subject and s.status <> 'removed' and s.teacher_id = public.my_teacher_id())
$$;
grant execute on function public.grade_mine(uuid, text) to authenticated;

drop policy if exists grades_teacher on public.grades;
create policy grades_teacher on public.grades for all to authenticated
  using (public.grade_mine(student_id, subject)) with check (public.grade_mine(student_id, subject));
drop policy if exists grades_admin on public.grades;
create policy grades_admin on public.grades for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select to authenticated using (public.my_role() in ('manager', 'supervisor'));
