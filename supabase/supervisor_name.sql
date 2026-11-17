-- اسم المشرف التربوي: يُكتب في «الإعدادات» ← «بيانات المدرسة»، ويظهر ثلاثيًا في خانة توقيع المشرف التربوي
-- (إنذار الطالب، سجل المخالفات المطبوع، تنبيه العاملين). شغّل هذا الملف مرة في محرر SQL في Supabase.
alter table public.settings add column if not exists supervisor_name text not null default '';
