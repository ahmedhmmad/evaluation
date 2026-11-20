-- معالج إعداد مدرسة جديدة وهويتها.
-- شغّل هذا الملف مرة في محرر SQL في Supabase (وهو ضمن install.sql). لا يغيّر بيانات المدرسة القائمة.
--
-- 1) هوية المدرسة في الإعدادات: الاسم الإنجليزي، والشعار وصورة الترويسة (صور مضغوطة data:image/... يرفعها المدير العام
--    من المعالج أو من «بيانات المدرسة»). إن كانت فارغة بقيت الصور الثابتة logo.png و banner.jpg.
-- 2) setup_done: هل أُنهي معالج الإعداد. يُعدّ منتهيًا تلقائيًا في مدرسة قائمة (فيها مدير عام عند تشغيل الملف أول مرة)،
--    فلا يظهر المعالج لها؛ وفي قاعدة جديدة يبقى false إلى أن يضغط المدير «إنهاء الإعداد».
--    brand_legacy: true للمدرسة الأصلية فقط (القائمة عند تشغيل الملف أول مرة)، فتبقى لها القيم الاحتياطية المكتوبة في الكود
--    (الاسم والعنوان والهاتف واسم المديرة وصور الترويسة والأوراق). في مدرسة جديدة false: لا يُطبع شيء من بيانات مدرسة أخرى.
-- 3) claim_first_admin(): أول حساب في مدرسة لا مدير عام فيها يصبح مديرًا عامًّا بنفسه، بلا أمر SQL.
--    لا تفعل شيئًا إن وُجد مدير عام، فلا يمكن استعمالها في مدرسة قائمة.
-- 4) school_brand(): اسم المدرسة وهل فيها مدير عام وهل أُنهي الإعداد، لكل زائر (حتى قبل الدخول) لتظهر صفحة الدخول باسمها.
--    school_brand_images(): الشعار والترويسة؛ تُجلب فقط إن تغيّر brand_ver عمّا حفظه المتصفح.

alter table public.settings add column if not exists school_name text not null default '';
alter table public.settings add column if not exists school_name_en text not null default '';
alter table public.settings add column if not exists logo_data text not null default '';
alter table public.settings add column if not exists banner_data text not null default '';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'settings' and column_name = 'setup_done') then
    alter table public.settings add column setup_done boolean not null default false;
    -- مدرسة قائمة: الإعداد منتهٍ
    update public.settings set setup_done = true
     where exists (select 1 from public.profiles where role = 'superadmin');
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'settings' and column_name = 'brand_legacy') then
    alter table public.settings add column brand_legacy boolean not null default false;
    update public.settings set brand_legacy = true
     where exists (select 1 from public.profiles where role = 'superadmin');
  end if;
end $$;

create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  -- حسابان يحاولان في اللحظة نفسها: واحد فقط يمرّ
  perform pg_advisory_xact_lock(hashtext('claim_first_admin'));
  if exists (select 1 from public.profiles where role = 'superadmin') then return false; end if;
  update public.profiles set role = 'superadmin' where id = auth.uid();
  return found;
end $$;

create or replace function public.school_brand()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce((select nullif(s.school_name, '') from public.settings s where s.id = 1), ''),
    'name_en', coalesce((select nullif(s.school_name_en, '') from public.settings s where s.id = 1), ''),
    'subtitle', coalesce((select nullif(to_jsonb(s) ->> 'report_subtitle', '') from public.settings s where s.id = 1), ''),
    'has_admin', exists (select 1 from public.profiles where role = 'superadmin'),
    'setup_done', coalesce((select s.setup_done from public.settings s where s.id = 1), false),
    'legacy', coalesce((select s.brand_legacy from public.settings s where s.id = 1), false),
    'brand_ver', coalesce((select md5(s.logo_data || '|' || s.banner_data) from public.settings s where s.id = 1), ''),
    'has_logo', coalesce((select s.logo_data <> '' from public.settings s where s.id = 1), false),
    'has_banner', coalesce((select s.banner_data <> '' from public.settings s where s.id = 1), false)
  );
$$;

create or replace function public.school_brand_images()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('logo', s.logo_data, 'banner', s.banner_data, 'brand_ver', md5(s.logo_data || '|' || s.banner_data))
    from public.settings s where s.id = 1;
$$;

revoke execute on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated;
grant execute on function public.school_brand() to anon, authenticated;
grant execute on function public.school_brand_images() to anon, authenticated;
