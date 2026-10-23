-- المعلم صاحب الحساب يقرأ سجله هو في «بيانات العاملين» (اسمه ومباحثه وشعبه)، ليظهر له «جدولي».
-- قبل هذا الملف لا يقرأ المعلم أي سجل في teachers، فيظهر له «حسابك غير مربوط بسجل معلم» مع أن حسابه مربوط.
-- لا يرى سجلات غيره، ولا يعدّل شيئًا. شغّل هذا الملف في محرر SQL في Supabase، ويمكن تشغيله مرة أخرى.

drop policy if exists teachers_self_read on public.teachers;
create policy teachers_self_read on public.teachers
  for select to authenticated
  using (public.my_role() = 'teacher' and id = (select p.teacher_id from public.profiles p where p.id = auth.uid()));
