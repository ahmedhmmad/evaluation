-- صلاحيات الموظفين: مدير النظام يختار حسابًا ويحدد أي شاشات المدير تظهر عنده ويتحكم بها
-- («الإعدادات والمستخدمون» ← «صلاحيات الموظفين»): المواصلات، العهد، المطالبات المالية، شئون الطلاب، الحضور والغياب...
-- الشاشات الممنوحة تُحفظ في profiles.perms (مفاتيح الشاشات)، ولا يغيّرها إلا مدير النظام (قاعدة profiles_update).
-- كيف تعمل: حين يفتح الموظف شاشة ممنوحة ترسل الصفحة مع كل طلب مفتاح تلك الشاشة (ترويسة x-act-area)، ودالة my_role()
-- تعامله كمدير النظام في ذلك الطلب فقط إن كانت الشاشة ممنوحة له فعلًا؛ وإلا فصلاحيته كما هي. فكل قواعد القاعدة تبقى كما هي.
-- ما لا يُفتح بالمنح أبدًا (perm_blocked): الحسابات والصلاحيات وكلمات المرور، سجل التعديلات، المفاتيح السرية، التوقيعات،
-- والرواتب إلا لمن مُنح شاشتي الرواتب. تطبيق الموبايل وروابط الغياب والملفات المرفوعة لا ترسل الترويسة، فتعمل بالصلاحية الأصلية.
-- شغّل هذا الملف مرة في محرر SQL في Supabase، ثم حدّث الصفحة.

alter table public.profiles add column if not exists perms text[] not null default '{}';
-- بقايا التجربة السابقة (صلاحيات إضافية بالتبديل) إن كانت شُغّلت
alter table public.profiles drop constraint if exists profiles_extra_roles_check;
alter table public.profiles drop column if exists extra_roles;

-- هل هذا الطلب (اسم الجدول أو الدالة في آخر مساره) ممنوع على من يعمل بشاشة ممنوحة؟
create or replace function public.perm_blocked(p_area text, p_path text) returns boolean
language sql immutable as $$
  select x.r in ('profiles', 'audit_log', 'private_settings', 'backup_status', 'payroll_access',
                 'signatures', 'sign_requests', 'signed_docs', 'sign_doc', 'sig_reject', 'sig_revoke', 'sig_request_print',
                 'create_user_account', 'create_teacher_account', 'reset_user_password', 'reset_teacher_password', 'parent_set_password', 'backup_new_key')
      or ((x.r like 'payroll%' or x.r = 'set_payroll_slips') and p_area not in ('payroll', 'payrun'))
  from (select regexp_replace(coalesce(p_path, ''), '^.*/', '') as r) x
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.role in ('pending', 'superadmin') or a.area = '' then p.role
    when not (a.area = any (coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(to_jsonb(p) -> 'perms', '[]'::jsonb)) v), '{}'))) then p.role
    when public.perm_blocked(a.area, a.path) then p.role
    else 'superadmin' end
  from public.profiles p,
    lateral (select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-act-area', '') as area,
                    coalesce(current_setting('request.path', true), '') as path) a
  where p.id = auth.uid();
$$;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;
