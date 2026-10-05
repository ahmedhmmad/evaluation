-- Teacher details, teacher login accounts, and school settings.
-- Run this file once in the Supabase SQL Editor, after schema.sql and visits.sql.

-- ---------- Teacher details ----------

alter table public.teachers
  add column if not exists classes text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists qualification text not null default '',
  add column if not exists hire_date date,
  add column if not exists details text not null default '',
  add column if not exists login text,                                            -- the email the teacher signs in with
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- Only the superadmin adds or removes teachers; supervisors still read them and fill in evaluations.
drop policy if exists teachers_staff on public.teachers;
drop policy if exists teachers_select on public.teachers;
drop policy if exists teachers_update on public.teachers;
drop policy if exists teachers_insert on public.teachers;
drop policy if exists teachers_delete on public.teachers;

create policy teachers_select on public.teachers
  for select to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'));
create policy teachers_update on public.teachers
  for update to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));
create policy teachers_insert on public.teachers
  for insert to authenticated
  with check (public.my_role() = 'superadmin');
create policy teachers_delete on public.teachers
  for delete to authenticated
  using (public.my_role() = 'superadmin');

-- ---------- Teacher role ----------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'supervisor', 'superadmin'));

alter table public.profiles
  add column if not exists teacher_id uuid references public.teachers (id) on delete set null,
  add column if not exists must_change_password boolean not null default false;

-- ---------- School settings ----------

alter table public.settings
  add column if not exists principal_name text not null default 'أ. سمر أبو مدين';

-- Readable by the superadmin only (the default password must not be visible to other accounts).
create table if not exists public.private_settings (
  id int primary key default 1 check (id = 1),
  default_password text not null default ''
);
insert into public.private_settings (id) values (1) on conflict (id) do nothing;

alter table public.private_settings enable row level security;
revoke all on public.private_settings from anon;
grant select, update on public.private_settings to authenticated;

drop policy if exists private_settings_admin on public.private_settings;
create policy private_settings_admin on public.private_settings
  for all to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');

-- ---------- Teacher accounts ----------

-- Creates the login for a teacher with the given password, already confirmed,
-- and marks it so the teacher must choose a new password at first sign-in.
create or replace function public.create_teacher_account(p_teacher uuid, p_login text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t public.teachers;
  v_email text := lower(trim(p_login));
  v_uid uuid := gen_random_uuid();
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'غير مصرح';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور الافتراضية يجب ألا تقل عن 6 أحرف';
  end if;
  select * into t from public.teachers where id = p_teacher;
  if not found then
    raise exception 'المعلم غير موجود';
  end if;
  if t.user_id is not null then
    raise exception 'لهذا المعلم حساب مسبقًا';
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
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', t.name), now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  -- the sign-up trigger has created the profile as 'pending'; turn it into this teacher's account
  insert into public.profiles (id, email, full_name) values (v_uid, v_email, t.name)
  on conflict (id) do nothing;
  update public.profiles
     set role = 'teacher', teacher_id = t.id, full_name = t.name, must_change_password = true
   where id = v_uid;

  update public.teachers set user_id = v_uid, login = v_email where id = t.id;
  return v_uid;
end;
$$;

create or replace function public.reset_teacher_password(p_teacher uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'غير مصرح';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور الافتراضية يجب ألا تقل عن 6 أحرف';
  end if;
  select user_id into v_uid from public.teachers where id = p_teacher;
  if v_uid is null then
    raise exception 'لا يوجد حساب لهذا المعلم';
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = v_uid;
  update public.profiles set must_change_password = true where id = v_uid;
end;
$$;

-- Called by a user right after choosing their own password.
create or replace function public.finish_password_change()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- Removing a teacher removes their login too.
create or replace function public.remove_teacher_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.user_id is not null then
    delete from auth.users where id = old.user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists teachers_remove_account on public.teachers;
create trigger teachers_remove_account
  after delete on public.teachers
  for each row execute function public.remove_teacher_account();

revoke execute on function public.create_teacher_account(uuid, text, text) from public, anon;
revoke execute on function public.reset_teacher_password(uuid, text) from public, anon;
revoke execute on function public.finish_password_change() from public, anon;
grant execute on function public.create_teacher_account(uuid, text, text) to authenticated;
grant execute on function public.reset_teacher_password(uuid, text) to authenticated;
grant execute on function public.finish_password_change() to authenticated;

-- ---------- Results: a teacher sees only their own published evaluation ----------

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
  if r is null or r = 'pending' then
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
