-- عنوان الأكاديمية وهاتفها وصفحة فيسبوك: يُعدَّلان من «الإعدادات والمستخدمون» ويظهران أسفل الخطابات الرسمية (الطلبيات).
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.
alter table public.settings add column if not exists school_address text;
alter table public.settings add column if not exists school_phone text;
alter table public.settings add column if not exists school_facebook text;
