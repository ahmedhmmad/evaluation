-- معلمون يرصدون درجات اختبار من شاشة «الاختبارات» (مثل القرآن الكريم أو القراءة العربية): كل اختبار يُكلَّف به معلم أو أكثر،
-- فيرى المعلم في صفحته «رصد الاختبارات» اختباراته المكلّف بها فقط: طلابها وخانة الدرجة، ويطبع كشفها بنفس شكل شاشة الاختبارات.
-- لا يقرأ المعلم جدول student_exams ولا جدول الطلاب مباشرة: يقرأ عبر my_exams() ويحفظ الدرجات فقط عبر exam_save_grades().
-- شغّل هذا الملف مرة في محرر SQL في Supabase، بعد student_exams.sql و teacher_papers.sql. آمن لإعادة التشغيل ولا يغيّر بيانات موجودة.

alter table public.student_exams add column if not exists teacher_ids uuid[] not null default '{}';  -- المعلمون المكلّفون برصد الدرجات

-- اختبارات المعلم الحالي مع طلابها (الاسم، الصف، تاريخ الميلاد، مكان الميلاد، مدرس المادة في صفه) ودرجاتهم
create or replace function public.my_exams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'exam_date', e.exam_date, 'subject', e.subject, 'committee', to_jsonb(e.committee),
      'bands', e.bands, 'grades', e.grades,
      'teachers', (select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) from teachers t where t.id = any (e.teacher_ids)),
      'students', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.id, 'full_name', x.full_name, 'class_name', x.class_name, 'birth_date', x.birth_date,
            'birth_place', x.details ->> 'birth_place',
            'teacher', (select string_agg(distinct t2.name, '، ') from timetable_sessions s join teachers t2 on t2.id = s.teacher_id
                        where e.subject <> '' and s.class_name = x.class_name and s.subject = e.subject and s.status <> 'removed')
          ) order by x.class_name, x.full_name), '[]'::jsonb)
        from students x where x.id = any (e.student_ids))
    ) order by e.exam_date desc, e.created_at desc), '[]'::jsonb)
  from student_exams e
  where public.my_teacher_id() is not null and public.my_teacher_id() = any (e.teacher_ids)
$$;
grant execute on function public.my_exams() to authenticated;

-- حفظ درجات اختبار مكلَّف به المعلم: { معرّف الطالب: الدرجة }؛ الفارغ يمسح الدرجة. لا يمسّ إلا طلاب الاختبار ولا يغيّر شيئًا غير الدرجات
create or replace function public.exam_save_grades(p_exam uuid, p_grades jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e student_exams%rowtype;
  k text;
  v text;
  g jsonb;
begin
  select * into e from student_exams where id = p_exam;
  if not found or public.my_teacher_id() is null or not (public.my_teacher_id() = any (e.teacher_ids)) then
    raise exception 'هذا الاختبار غير مكلَّف به حسابك' using errcode = '42501';
  end if;
  g := e.grades;
  for k, v in select key, value from jsonb_each_text(coalesce(p_grades, '{}'::jsonb)) loop
    if not (k::uuid = any (e.student_ids)) then continue; end if;
    if btrim(coalesce(v, '')) = '' then g := g - k; else g := g || jsonb_build_object(k, btrim(v)); end if;
  end loop;
  update student_exams set grades = g, updated_at = now() where id = p_exam;
  return g;
end
$$;
grant execute on function public.exam_save_grades(uuid, jsonb) to authenticated;
