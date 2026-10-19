-- "Student registrar" role: staff who register students at the desk, several at once.
-- A registrar can read, add and edit student records and choose a student's assembly point.
-- A registrar cannot delete students, see transport payments, teacher evaluations or settings screens.
-- Run this file once in the Supabase SQL Editor, after the other scripts.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin'));

-- Students: read, add, edit (no delete).
drop policy if exists students_registrar_select on public.students;
create policy students_registrar_select on public.students
  for select to authenticated
  using (public.my_role() = 'registrar');

drop policy if exists students_registrar_insert on public.students;
create policy students_registrar_insert on public.students
  for insert to authenticated
  with check (public.my_role() = 'registrar');

drop policy if exists students_registrar_update on public.students;
create policy students_registrar_update on public.students
  for update to authenticated
  using (public.my_role() = 'registrar')
  with check (public.my_role() = 'registrar');

-- Transport: see the assembly points, and put a student in one (or take them out) while registering.
drop policy if exists transport_groups_registrar on public.transport_groups;
create policy transport_groups_registrar on public.transport_groups
  for select to authenticated
  using (public.my_role() = 'registrar');

drop policy if exists transport_members_registrar on public.transport_members;
create policy transport_members_registrar on public.transport_members
  for all to authenticated
  using (public.my_role() = 'registrar')
  with check (public.my_role() = 'registrar');

-- Settings (school name, classes): readable by registrars too.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (public.my_role() in ('viewer', 'registrar', 'supervisor', 'superadmin'));

-- Teacher evaluation results are not for registrars.
create or replace function public.get_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r text := public.my_role();
  s public.settings;
  own uuid;
begin
  if r is null or r in ('pending', 'registrar') then
    return jsonb_build_object('settings', null, 'results', '[]'::jsonb);
  end if;

  select * into s from public.settings where id = 1;
  if r = 'teacher' then
    select teacher_id into own from public.profiles where id = auth.uid();
  end if;

  return jsonb_build_object(
    'settings', to_jsonb(s),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'subject', t.subject,
        'published_at', t.published_at,
        'total', case when s.show_totals then (
          select coalesce(sum(e.value::int), 0) from jsonb_each_text(t.ratings) e
        ) end,
        'ratings', case when s.show_items then t.ratings end,
        'notes', case when s.show_notes then t.notes end,
        'approver_notes', case when s.show_approver_notes then t.approver_notes end
      ) order by t.name)
      from public.teachers t
      where t.status = 'published' and t.visible
        and (r <> 'teacher' or t.id = own)
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------- Accounts created by the superadmin (registrars, supervisors, viewers) ----------

-- Creates a ready-to-use login with the given role. The person must choose a new password at first sign-in.
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
  if p_role not in ('viewer', 'registrar', 'supervisor') then
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

-- Sets a new temporary password for an account (not the superadmin's own); it must be changed at next sign-in.
create or replace function public.reset_user_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'غير مصرح';
  end if;
  if p_user = auth.uid() then
    raise exception 'غيّر كلمة مرورك من حسابك';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'الحساب غير موجود';
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  update public.profiles set must_change_password = true where id = p_user;
end;
$$;

revoke execute on function public.create_user_account(text, text, text, text) from public, anon;
revoke execute on function public.reset_user_password(uuid, text) from public, anon;
grant execute on function public.create_user_account(text, text, text, text) to authenticated;
grant execute on function public.reset_user_password(uuid, text) to authenticated;
