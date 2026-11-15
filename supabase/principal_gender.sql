-- صفة مدير الأكاديمية في التقارير: «مدير الأكاديمية» (m) أو «مديرة الأكاديمية» (f)؛ فارغ = «مدير/ة الأكاديمية».
-- تُختار من «الإعدادات» ← «بيانات المدرسة». شغّل هذا الملف مرة في محرر SQL في Supabase.
alter table public.settings add column if not exists principal_gender text not null default '';
