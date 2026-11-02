-- Attendance clerk (مسجّل حضور): an account whose only job is recording the daily student attendance, from the mobile app.
-- It sees the classes and their rolls and saves the day's absentees (through api_att_classes / api_att_roll / api_att_submit); nothing else.
-- It has no access to students' files, payments, the timetable or any web screen.
-- Run this file once in the Supabase SQL Editor, after registrar.sql and api.sql. It does not change existing data.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin', 'attclerk'));

create or replace function public.create_user_account(p_name text, p_login text, p_password text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(p_login));
  v_name text := trim(coalesce(p_name, ''));
  v_uid uuid := gen_random_uuid();
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'غير مصرح';
  end if;
  if p_role not in ('viewer', 'registrar', 'supervisor', 'attclerk') then
    raise exception 'صلاحية غير مسموحة';
  end if;
  if v_name = '' or v_email = '' then
    raise exception 'الاسم واسم المستخدم مطلوبان';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'اسم المستخدم مستخدم لحساب آخر';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_name), now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  -- the sign-up trigger has created the profile as 'pending'; give it its name and role
  insert into public.profiles (id, email, full_name) values (v_uid, v_email, v_name)
  on conflict (id) do nothing;
  update public.profiles
     set role = p_role, full_name = v_name, must_change_password = true
   where id = v_uid;
  return v_uid;
end;
$$;

create or replace function public.api_att_classes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('teacher', public.api_att_who(), 'day', att_today(), 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.class_name, 'students', c.students,
      'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name)) order by c.pos)
    from att_classes() c), '[]'::jsonb));
end $$;

create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$;

create or replace function public.api_att_submit(p_class text, p_absent uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  if not exists (select 1 from att_classes() c where c.class_name = p_class) then raise exception 'الشعبة غير موجودة'; end if;
  n := att_save(p_class, p_absent, public.api_att_who());
  return jsonb_build_object('saved', n, 'absent', coalesce((
    select jsonb_agg(r.full_name order by r.pos) from att_roll(p_class) r where r.id = any (coalesce(p_absent, '{}'))), '[]'::jsonb));
end $$;

revoke execute on function public.create_user_account(text, text, text, text) from public, anon;
grant execute on function public.create_user_account(text, text, text, text) to authenticated;
grant execute on function public.api_att_classes(), public.api_att_roll(text), public.api_att_submit(text, uuid[]) to authenticated;
