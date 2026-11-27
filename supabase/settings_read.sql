-- «بيانات المدرسة» (اسم الأكاديمية، العنوان، اسم المدير والمشرف التربوي، الشعب…) يقرؤها كل حساب مفعَّل،
-- ومنها المعلمون: بدونها تخرج تقاريرهم بلا اسم المدير والمشرف في خانات التوقيع. لا شيء سري فيها
-- (كلمة المرور الافتراضية في private_settings). التعديل يبقى للمدير العام فقط.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (coalesce(public.my_role(), 'pending') <> 'pending');
