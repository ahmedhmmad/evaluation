-- صلاحية «مشرف عام»: صلاحيات المدير نفسها (يرى كل شيء ويصدّر، ويعدّل الرواتب إن مُنحها)، باسم مستقل يظهر في حسابه.
-- تُحفظ كدور المدير (manager) مع role_title = 'general_supervisor'، فكل صلاحيات المدير في القاعدة تشمله دون تغيير.
-- المدير العام وحده يعدّل الحسابات (profiles)، فلا يغيّر أحد صلاحيته بنفسه.
-- شغّل هذا الملف في محرر SQL في Supabase، ويمكن تشغيله مرة أخرى. لا يغيّر أي حساب موجود.

alter table public.profiles add column if not exists role_title text not null default '';
