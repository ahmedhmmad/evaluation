-- مجموعات الدوام في «دوام الموظفين»: لكل مجموعة اسم ووقت حضور وانصراف، ولكل موظف مجموعته.
-- من لا مجموعة له فدوامه الوقت الرسمي (time_in / time_out). بها يُحسب التأخير والانصراف المبكر والحضور والانصراف الموحدان وأجر الساعة في الرواتب.
--   groups: [ { "id": "g…", "name": "المحفظون", "time_in": "08:00", "time_out": "10:00" }, … ]
--   assign: { "<teacher_id>": "g…", … }
-- يعدّلها من يعدّل الوقت الرسمي (المدير العام والمدير). شغّل هذا الملف في محرر SQL في Supabase (بعد staff_attendance.sql)،
-- ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات موجودة.

alter table public.staff_hours
  add column if not exists groups jsonb not null default '[]'::jsonb,
  add column if not exists assign jsonb not null default '{}'::jsonb;
