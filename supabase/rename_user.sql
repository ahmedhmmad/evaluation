-- تغيير اسم المستخدم لحساب موجود (زر «تغيير اسم المستخدم» في الإعدادات ← المستخدمون والصلاحيات).
-- يغيّره المدير العام فقط، لأي حساب غير حسابه. كلمة المرور والصلاحية تبقيان كما هما.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create or replace function public.rename_user_login(p_user uuid, p_login text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_login, '')));
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'غير مصرح';
  end if;
  if p_user = auth.uid() then
    raise exception 'لا يمكنك تغيير اسم المستخدم لحسابك';
  end if;
  if v_email = '' or v_email ~ '\s' or v_email !~ '^[^@]+@[^@]+$' then
    raise exception 'اسم المستخدم غير صالح';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'الحساب غير موجود';
  end if;
  if exists (select 1 from auth.users where email = v_email and id <> p_user) then
    raise exception 'اسم المستخدم مستخدم لحساب آخر';
  end if;

  update auth.users set email = v_email, updated_at = now() where id = p_user;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_user and provider = 'email';
  update public.profiles set email = v_email where id = p_user;
  update public.teachers set login = v_email where user_id = p_user;
end;
$$;

revoke execute on function public.rename_user_login(uuid, text) from public, anon;
grant execute on function public.rename_user_login(uuid, text) to authenticated;
