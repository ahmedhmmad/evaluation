-- صلاحيات إضافية للحساب: يبقى لكل حساب صلاحيته الأساسية (role)، ويمنحه مدير النظام صلاحيات أخرى (extra_roles)
-- من «الإعدادات والمستخدمون»، فيبدّل صاحب الحساب بينها من أسفل القائمة الجانبية («أعمل الآن بصلاحية») دون حساب ثانٍ.
-- مثال: حساب معلم يُمنح «مسجِّل طلاب»، فيسجّل الطلاب والمواصلات بالحساب نفسه.
-- كيف تعمل: الصفحة ترسل مع كل طلب الصلاحية التي يعمل بها الحساب الآن (ترويسة x-act-role)، ودالة my_role()
-- تعتمدها فقط إن كانت من الصلاحيات التي منحها مدير النظام لهذا الحساب؛ وإلا فالصلاحية الأساسية. فكل قواعد القاعدة تبقى كما هي.
-- لا يمكن منح «مدير النظام» صلاحيةً إضافية، ولا يغيّر extra_roles إلا مدير النظام (قاعدة profiles_update).
-- تطبيق الموبايل وروابط الغياب لا ترسل الترويسة، فتعمل بالصلاحية الأساسية.
-- شغّل هذا الملف مرة في محرر SQL في Supabase، ثم حدّث الصفحة.

alter table public.profiles add column if not exists extra_roles text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_extra_roles_check;
alter table public.profiles add constraint profiles_extra_roles_check
  check (extra_roles <@ array['registrar', 'supervisor', 'manager']::text[]);

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p.role not in ('pending', 'superadmin') and h.r <> '' and h.r = any (p.extra_roles) then h.r else p.role end
  from public.profiles p,
    lateral (select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-act-role', '') as r) h
  where p.id = auth.uid();
$$;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;
