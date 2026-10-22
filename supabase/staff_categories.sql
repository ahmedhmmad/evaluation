-- فئات العاملين في «بيانات العاملين»: تُضاف فئة «مشرفون» إلى الفئات السابقة.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql)، ويمكن تشغيله مرة أخرى. لا يغيّر فئة أي عامل.

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.teachers'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%category%' loop
    execute format('alter table public.teachers drop constraint %I', c);
  end loop;
end $$;

alter table public.teachers add constraint teachers_category_check
  check (category in ('إدارية', 'مشرفون', 'هيئة تدريس', 'محفظون', 'خدمات مساندة', 'خدمات معاونة'));
