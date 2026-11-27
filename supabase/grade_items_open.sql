  -- حالة كل اختبار للمعلمين في «إعداد الدرجات»: مفتوح أو معطّل أو مغلق.
  -- مفتوح: يرصدون فيه. معطّل: يرون عموده ودرجاته للقراءة فقط (ويدخل في المجموع). مغلق: لا يظهر لهم.
  -- لا يقبل المعطّل ولا المغلق حفظًا ولا تعديلًا من المعلم، والإدارة ترصد وتعدّل دائمًا.
  -- الاختبارات الموجودة تبقى مفتوحة. شغّل هذا الملف في محرر SQL في Supabase. آمن لإعادة التشغيل.

  alter table public.grade_items add column if not exists open boolean not null default true;
  -- غير المفتوح: shown = معطّل (يظهر للمعلم للقراءة فقط)، وإلا فمغلق (لا يظهر له)
  alter table public.grade_items add column if not exists shown boolean not null default false;

  -- المعلم: يقرأ درجات طلاب شعبه في مواده هو، ويكتب فقط في الاختبارات المفتوحة
  drop policy if exists grades_teacher on public.grades;
  drop policy if exists grades_teacher_read on public.grades;
  create policy grades_teacher_read on public.grades for select to authenticated
    using (public.grade_mine(student_id, subject));
  drop policy if exists grades_teacher_insert on public.grades;
  create policy grades_teacher_insert on public.grades for insert to authenticated
    with check (public.grade_mine(student_id, subject) and exists (select 1 from public.grade_items i where i.id = item_id and i.open));
  drop policy if exists grades_teacher_update on public.grades;
  create policy grades_teacher_update on public.grades for update to authenticated
    using (public.grade_mine(student_id, subject) and exists (select 1 from public.grade_items i where i.id = item_id and i.open))
    with check (public.grade_mine(student_id, subject) and exists (select 1 from public.grade_items i where i.id = item_id and i.open));
  drop policy if exists grades_teacher_delete on public.grades;
  create policy grades_teacher_delete on public.grades for delete to authenticated
    using (public.grade_mine(student_id, subject) and exists (select 1 from public.grade_items i where i.id = item_id and i.open));
