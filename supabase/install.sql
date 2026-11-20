-- ملف التثبيت الكامل لقاعدة بيانات مدرسة جديدة على Supabase (انظر docs/NEW_SCHOOL.md).
-- يُشغَّل مرة واحدة في مشروع Supabase جديد: SQL Editor -> New query -> الصق الملف كله -> Run.
-- لا تعدّله باليد: يُولَّد من ملفات supabase/*.sql بالأمر  node tools/build-install.js
-- تشغيله مرة ثانية على المشروع نفسه آمن ولا يغيّر شيئًا.


-- ================================================================
-- schema.sql
-- ================================================================
-- Teacher evaluation: database schema for Supabase.
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> Run.

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending'
    check (role in ('pending', 'viewer', 'supervisor', 'superadmin')),
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  status text not null default 'new'
    check (status in ('new', 'edit', 'review', 'approved', 'published')),
  ratings jsonb not null default '{}'::jsonb,
  notes text not null default '',
  approver_notes text not null default '',
  approved_at timestamptz,
  published_at timestamptz,
  visible boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Single row: what viewer accounts are allowed to see.
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  show_totals boolean not null default true,
  show_items boolean not null default true,
  show_notes boolean not null default false,
  show_approver_notes boolean not null default false
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- Helpers ----------

-- النسخة المعتمدة من my_role في extra_roles.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'my_role' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$
    $fn$;
  end if;
end $guard$;

-- Every new sign-up gets a profile with role 'pending' (no access until a superadmin assigns a role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles.email is only a display copy of the login email in auth.users; keep it in step.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Only the superadmin may show/hide an evaluation from viewers.
create or replace function public.guard_teacher_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visible is distinct from old.visible
     and coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'Only the superadmin can change visibility';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists teachers_guard_visibility on public.teachers;
create trigger teachers_guard_visibility
  before update on public.teachers
  for each row execute function public.guard_teacher_visibility();

-- What viewers get: published + visible evaluations, with hidden parts removed on the server.
-- النسخة المعتمدة من get_results في registrar.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'get_results' and pronamespace = 'public'::regnamespace) then
    execute $fn$
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
begin
  if r is null or r = 'pending' then
    return jsonb_build_object('settings', null, 'results', '[]'::jsonb);
  end if;

  select * into s from public.settings where id = 1;

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
    ), '[]'::jsonb)
  );
end;
$$
    $fn$;
  end if;
end $guard$;

-- ---------- Permissions ----------

alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.settings enable row level security;

revoke all on public.profiles, public.teachers, public.settings from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.teachers to authenticated;
grant select, update on public.settings to authenticated;

revoke execute on function public.get_results() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.get_results() to authenticated;
grant execute on function public.my_role() to authenticated;

-- Profiles: each user reads their own; the superadmin reads all and assigns roles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.my_role() = 'superadmin');

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');

-- Teachers and evaluations: supervisors and the superadmin only.
-- Viewers never read this table directly; they go through get_results().
drop policy if exists teachers_staff on public.teachers;
create policy teachers_staff on public.teachers
  for all to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));

-- Settings: readable by active accounts, changed by the superadmin only.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (public.my_role() in ('viewer', 'supervisor', 'superadmin'));

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');

-- ---------- First superadmin ----------
-- After you sign up on the page, run this once with your own email:
--
--   update public.profiles set role = 'superadmin' where email = 'you@example.com';



-- ================================================================
-- audit_log.sql
-- ================================================================
-- سجل التعديلات: من أضاف أو عدّل أو حذف ماذا ومتى، في الجداول المهمة.
-- يكتبه القاعدة نفسها (triggers) عند كل تغيير، سواء من البرنامج أو من محرر SQL، فلا يمكن تجاوزه من الصفحة.
-- يقرؤه المدير العام وحده، ولا يملك أحد تعديله أو حذفه من البرنامج.
-- لا يُسجَّل فيه ما فيه أسرار (كلمة المرور الافتراضية، روابط الغياب السرية، مفتاح البوت).
-- شغّل هذا الملف في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة، ويبدأ التسجيل من لحظة تشغيله.
-- يُعاد تشغيله بأمان متى أُضيفت جداول إلى قائمته (آخر إضافة: الدرجات، شئون الطلاب، سندات الصرف، الطلبيات، العهد، اللجان، الزيارات).

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,                         -- صاحب الحساب الذي نفّذ التغيير (فارغ: من محرر SQL أو رابط الغياب)
  user_name text not null default '',
  tbl text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_key text not null default '',     -- ما يُعرف به السجل (المعرّف، أو الطالب والشهر، أو رقم الإيصال)
  student_id uuid,                      -- الطالب المعني إن وُجد، للبحث باسمه
  receipt_no bigint,                    -- رقم الإيصال إن وُجد
  old jsonb,                            -- في التعديل: الحقول التي تغيّرت فقط، بقيمها قبل وبعد في old و new
  new jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_student_idx on public.audit_log (student_id);
create index if not exists audit_log_receipt_idx on public.audit_log (receipt_no);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.my_role() = 'superadmin');

-- اسم صاحب الحساب الحالي
create or replace function public.audit_who() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid()), '')
$$;

-- سطر لكل سجل تغيّر. وسائط الـ trigger: أعمدة مفتاح السجل (مثل 'id' أو 'student_id', 'month')
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  oc jsonb := '{}'::jsonb;
  nc jsonb := '{}'::jsonb;
  k text;
  rkey text := '';
  who text := public.audit_who();
  i int;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
        oc := oc || jsonb_build_object(k, o -> k);
        nc := nc || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if oc = '{}'::jsonb then return null; end if;   -- حفظ بلا تغيير فعلي
    o := oc; n := nc;
  end if;
  for i in 0 .. tg_nargs - 1 loop
    rkey := concat_ws(' | ', nullif(rkey, ''), r ->> tg_argv[i]);
  end loop;
  -- من لم يدخل بحساب (محرر SQL): يُؤخذ الاسم المكتوب في السجل إن وُجد
  if who = '' then who := coalesce(nullif(r ->> 'updated_by', ''), nullif(r ->> 'issued_by', ''), case when auth.uid() is null then 'محرر SQL / النظام' else '' end); end if;
  insert into audit_log (user_id, user_name, tbl, action, row_key, student_id, receipt_no, old, new)
  values (auth.uid(), who, tg_table_name, lower(tg_op), rkey,
    case when tg_table_name = 'students' then (r ->> 'id')::uuid
         when r ? 'student_id' and (r ->> 'student_id') ~ '^[0-9a-f-]{36}$' then (r ->> 'student_id')::uuid end,
    case when (r ->> 'receipt_no') ~ '^[0-9]+$' then (r ->> 'receipt_no')::bigint end,
    o, n);
  return null;
end $$;

-- الغياب: سطر واحد لكل شعبة ويوم في كل عملية حفظ، لا سطر لكل طالب
create or replace function public.audit_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.audit_who();
  g record;
begin
  if tg_op = 'INSERT' then
    for g in select day, class_name, count(*) as n, count(*) filter (where status in ('absent', 'excused')) as a, max(recorded_by) as rb
             from new_rows group by day, class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.rb, ''), 'رابط الغياب'), 'attendance', 'insert', g.class_name || ' | ' || g.day,
        jsonb_build_object('day', g.day, 'class_name', g.class_name, 'students', g.n, 'absent', g.a));
    end loop;
  elsif tg_op = 'UPDATE' then
    for g in select n.day, n.class_name, max(n.recorded_by) as rb,
               jsonb_agg(jsonb_build_object('student_id', n.student_id, 'from', o.status, 'to', n.status)) as ch
             from new_rows n join old_rows o on o.student_id = n.student_id and o.day = n.day
             where o.status is distinct from n.status
             group by n.day, n.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.rb, ''), 'رابط الغياب'), 'attendance', 'update', g.class_name || ' | ' || g.day,
        jsonb_build_object('day', g.day, 'class_name', g.class_name, 'changes', g.ch));
    end loop;
  else
    for g in select day, class_name, count(*) as n from old_rows group by day, class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, old)
      values (auth.uid(), coalesce(nullif(who, ''), 'رابط الغياب'), 'attendance', 'delete', g.class_name || ' | ' || g.day,
        jsonb_build_object('day', g.day, 'class_name', g.class_name, 'students', g.n));
    end loop;
  end if;
  return null;
end $$;

-- الدرجات: سطر واحد لكل اختبار ومادة وشعبة في كل عملية حفظ، لا سطر لكل طالب. في التعديل: من تغيّرت درجته، من كم إلى كم
create or replace function public.audit_grades() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.audit_who();
  g record;
begin
  if tg_op = 'INSERT' then
    for g in select i.name as item, n.subject, coalesce(x.class_name, '') as class_name, count(*) as n, max(n.updated_by) as ub
             from new_rows n left join grade_items i on i.id = n.item_id left join students x on x.id = n.student_id
             where n.score is not null group by i.name, n.subject, x.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.ub, ''), 'محرر SQL / النظام'), 'grades', 'insert', concat_ws(' | ', g.item, g.subject, g.class_name),
        jsonb_build_object('item', g.item, 'subject', g.subject, 'class_name', g.class_name, 'students', g.n));
    end loop;
  elsif tg_op = 'UPDATE' then
    for g in select i.name as item, n.subject, coalesce(x.class_name, '') as class_name, max(n.updated_by) as ub,
               jsonb_agg(jsonb_build_object('student_id', n.student_id, 'from', o.score, 'to', n.score)) as ch
             from new_rows n join old_rows o on o.student_id = n.student_id and o.item_id = n.item_id and o.subject = n.subject
             left join grade_items i on i.id = n.item_id left join students x on x.id = n.student_id
             where o.score is distinct from n.score group by i.name, n.subject, x.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.ub, ''), 'محرر SQL / النظام'), 'grades', 'update', concat_ws(' | ', g.item, g.subject, g.class_name),
        jsonb_build_object('item', g.item, 'subject', g.subject, 'class_name', g.class_name, 'changes', g.ch));
    end loop;
  else
    for g in select i.name as item, o.subject, coalesce(x.class_name, '') as class_name, count(*) as n
             from old_rows o left join grade_items i on i.id = o.item_id left join students x on x.id = o.student_id
             group by i.name, o.subject, x.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, old)
      values (auth.uid(), coalesce(nullif(who, ''), 'محرر SQL / النظام'), 'grades', 'delete', concat_ws(' | ', g.item, g.subject, g.class_name),
        jsonb_build_object('item', g.item, 'subject', g.subject, 'class_name', g.class_name, 'students', g.n));
    end loop;
  end if;
  return null;
end $$;

-- ربط الجداول. كل جدول غير موجود بعد يُتخطّى، فيمكن تشغيل الملف مرة أخرى بعد إضافة جداول جديدة
do $$
declare
  t record;
begin
  for t in select * from (values
      ('students', 'id'), ('teachers', 'id'), ('profiles', 'id'), ('settings', 'id'),
      ('transport_groups', 'id'), ('transport_members', 'student_id'), ('transport_payments', 'student_id, month'),
      ('transport_topups', 'receipt_no'), ('transport_refunds', 'refund_no'), ('transport_voided', 'receipt_no'),
      ('timetable_sessions', 'id'), ('timetable_config', 'id'), ('timetable_proposals', 'id'),
      ('grade_items', 'id'), ('student_leaves', 'id'), ('discipline_records', 'id'), ('student_exits', 'id'),
      ('payment_claims', 'no'), ('orders', 'no'), ('custody_items', 'id'), ('committees', 'id'), ('committee_members', 'id'),
      ('student_lists', 'id'), ('visits', 'id'), ('statements', 'id')
    ) as v(name, keys)
  loop
    if to_regclass('public.' || t.name) is null then continue; end if;
    execute format('drop trigger if exists audit_row on public.%I', t.name);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%s)',
      t.name, (select string_agg(quote_literal(trim(k)), ', ') from unnest(string_to_array(t.keys, ',')) k));
  end loop;

  if to_regclass('public.attendance') is not null then
    drop trigger if exists audit_att_ins on public.attendance;
    drop trigger if exists audit_att_upd on public.attendance;
    drop trigger if exists audit_att_del on public.attendance;
    create trigger audit_att_ins after insert on public.attendance referencing new table as new_rows
      for each statement execute function public.audit_attendance();
    create trigger audit_att_upd after update on public.attendance referencing old table as old_rows new table as new_rows
      for each statement execute function public.audit_attendance();
    create trigger audit_att_del after delete on public.attendance referencing old table as old_rows
      for each statement execute function public.audit_attendance();
  end if;

  if to_regclass('public.grades') is not null then
    drop trigger if exists audit_grd_ins on public.grades;
    drop trigger if exists audit_grd_upd on public.grades;
    drop trigger if exists audit_grd_del on public.grades;
    create trigger audit_grd_ins after insert on public.grades referencing new table as new_rows
      for each statement execute function public.audit_grades();
    create trigger audit_grd_upd after update on public.grades referencing old table as old_rows new table as new_rows
      for each statement execute function public.audit_grades();
    create trigger audit_grd_del after delete on public.grades referencing old table as old_rows
      for each statement execute function public.audit_grades();
  end if;
end $$;



-- ================================================================
-- attendance_clerk.sql
-- ================================================================
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

-- النسخة المعتمدة من api_att_classes في api.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_classes' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_classes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('teacher', public.api_att_who(), 'day', att_today(), 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.class_name, 'students', c.students,
      'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name)) order by c.pos)
    from att_classes() c), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

-- النسخة المعتمدة من api_att_roll في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_roll' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

-- النسخة المعتمدة من api_att_submit في api.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_submit' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_submit(p_class text, p_absent uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  if not exists (select 1 from att_classes() c where c.class_name = p_class) then raise exception 'الشعبة غير موجودة'; end if;
  n := att_save(p_class, p_absent, public.api_att_who());
  return jsonb_build_object('saved', n, 'absent', coalesce((
    select jsonb_agg(r.full_name order by r.pos) from att_roll(p_class) r where r.id = any (coalesce(p_absent, '{}'))), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

revoke execute on function public.create_user_account(text, text, text, text) from public, anon;
grant execute on function public.create_user_account(text, text, text, text) to authenticated;
grant execute on function public.api_att_classes(), public.api_att_roll(text), public.api_att_submit(text, uuid[]) to authenticated;



-- ================================================================
-- auto_backup.sql
-- ================================================================
-- النسخ الاحتياطي التلقائي: n8n يطلب كل ليلة نسخة كاملة من القاعدة ويحفظها في Google Drive (n8n/auto-backup.json).
-- النسخة بنفس صيغة ملف «تنزيل نسخة احتياطية» في البرنامج، فتُستعاد من الشاشة نفسها.
-- الطلب يحتاج مفتاح النسخ (غير مفتاح بوت الغياب)؛ يراه المدير العام وحده في «الإعدادات والمستخدمون» ليضعه في n8n.
-- لا تدخل النسخة الأسرار: كلمة المرور الافتراضية، روابط الغياب السرية، مفتاح البوت، ولا سجل التعديلات.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.backup_status (
  id int primary key default 1 check (id = 1),
  backup_key text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_at timestamptz,          -- آخر نسخة حُفظت فعلًا في Drive
  last_file text not null default '',
  last_rows int not null default 0
);
insert into public.backup_status (id) values (1) on conflict (id) do nothing;

alter table public.backup_status enable row level security;
revoke all on public.backup_status from anon;
grant select on public.backup_status to authenticated;
drop policy if exists backup_status_admin on public.backup_status;
create policy backup_status_admin on public.backup_status
  for select to authenticated using (public.my_role() = 'superadmin');

-- النسخة كاملة. الجداول بنفس الترتيب والأسماء التي يستعيدها البرنامج (BACKUP_TABLES في index.html)
create or replace function public.backup_dump(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t text;
  rows jsonb;
  tables jsonb := '{}'::jsonb;
  cfg jsonb;
begin
  if p_key is null or p_key <> (select backup_key from backup_status where id = 1) then
    raise exception 'مفتاح النسخ غير صحيح';
  end if;
  foreach t in array array['teachers', 'visits', 'statements', 'students', 'transport_groups', 'transport_members', 'transport_payments',
      'transport_voided', 'transport_refunds', 'transport_topups', 'transport_staff_members', 'transport_staff_payments', 'transport_staff_refunds',
      'attendance', 'timetable_config', 'timetable_sessions', 'timetable_proposals', 'teacher_absences', 'substitutions',
      'staff_hours', 'staff_attendance'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    tables := tables || jsonb_build_object(t, rows);
  end loop;
  select to_jsonb(s) into cfg from settings s where id = 1;
  return jsonb_build_object('app', 'third-pillar-backup', 'version', 1, 'auto', true, 'created_at', now(),
    'school', coalesce(nullif(cfg ->> 'school_name', ''), 'أكاديمية الركيزة الثالثة'), 'settings', cfg, 'tables', tables);
end $$;

-- يستدعيها n8n بعد حفظ الملف في Drive، فيظهر في البرنامج وقت آخر نسخة ناجحة
create or replace function public.backup_done(p_key text, p_file text, p_rows int default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or p_key <> (select backup_key from backup_status where id = 1) then
    raise exception 'مفتاح النسخ غير صحيح';
  end if;
  update backup_status set last_at = now(), last_file = coalesce(p_file, ''), last_rows = coalesce(p_rows, 0) where id = 1;
end $$;

-- المدير العام يولّد مفتاحًا جديدًا إن تسرّب القديم (ثم يضعه في n8n)
create or replace function public.backup_new_key() returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'للمدير العام فقط'; end if;
  update backup_status set backup_key = k where id = 1;
  return k;
end $$;

revoke all on function public.backup_dump(text), public.backup_done(text, text, int), public.backup_new_key() from public;
grant execute on function public.backup_dump(text), public.backup_done(text, text, int) to anon, authenticated;
grant execute on function public.backup_new_key() to authenticated;



-- ================================================================
-- custody.sql
-- ================================================================
-- Custody (عهد): items the academy holds, with their quantity and notes.
-- Edited by the superadmin; read by the manager.
-- Run this file once in the Supabase SQL Editor, after manager.sql. It does not change existing data.

create table if not exists public.custody_items (
  id uuid primary key default gen_random_uuid(),
  item text not null,
  qty integer not null default 1 check (qty >= 0),
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custody_items enable row level security;
revoke all on public.custody_items from anon;
grant select, insert, update, delete on public.custody_items to authenticated;

drop policy if exists custody_edit on public.custody_items;
create policy custody_edit on public.custody_items
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists custody_read on public.custody_items;
create policy custody_read on public.custody_items
  for select to authenticated using (public.my_role() = 'manager');



-- ================================================================
-- general_supervisor.sql
-- ================================================================
-- صلاحية «مشرف عام»: صلاحيات المدير نفسها (يرى كل شيء ويصدّر، ويعدّل الرواتب إن مُنحها)، باسم مستقل يظهر في حسابه.
-- تُحفظ كدور المدير (manager) مع role_title = 'general_supervisor'، فكل صلاحيات المدير في القاعدة تشمله دون تغيير.
-- المدير العام وحده يعدّل الحسابات (profiles)، فلا يغيّر أحد صلاحيته بنفسه.
-- شغّل هذا الملف في محرر SQL في Supabase، ويمكن تشغيله مرة أخرى. لا يغيّر أي حساب موجود.

alter table public.profiles add column if not exists role_title text not null default '';



-- ================================================================
-- manager.sql
-- ================================================================
-- "Manager" role: sees every screen and every record, and changes nothing.
-- Read-only policies on each table; no insert/update/delete policy is given to this role, so the database
-- refuses any change it sends. Teacher absence links and their bot key stay with the superadmin only.
-- Run this file once in the Supabase SQL Editor, after the other scripts. It does not change existing data.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin'));

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'settings', 'teachers', 'visits', 'statements', 'students',
    'transport_groups', 'transport_members', 'transport_payments', 'transport_voided', 'transport_refunds', 'attendance']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_manager_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = ''manager'')', t || '_manager_read', t);
    end if;
  end loop;
end $$;



-- ================================================================
-- orders.sql
-- ================================================================
-- الطلبيات (خطابات طلب احتياجات للجهات الداعمة): المرسَل إليه، والموضوع، وجدول الأصناف بوحداتها وكمياتها، وتُطبع خطابًا رسميًا.
-- يُنشئها ويعدّلها المدير العام، ويراها المدير. شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  no serial,
  order_date date not null default current_date,
  recipient text not null default '',      -- السادة / جمعية ...
  recipient2 text not null default '',     -- سطر ثانٍ تحت اسم الجهة
  subject text not null default 'طلب احتياجات مدرسية',
  intro text not null default '',
  items jsonb not null default '[]',       -- [{item, unit, qty}]
  closing text not null default '',
  status text not null default 'draft',    -- draft, sent, received
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;
revoke all on public.orders from anon;
grant select, insert, update, delete on public.orders to authenticated;
grant usage on sequence public.orders_no_seq to authenticated;

drop policy if exists orders_edit on public.orders;
create policy orders_edit on public.orders
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated using (public.my_role() = 'manager');



-- ================================================================
-- outside_accounts.sql
-- ================================================================
-- Outside and test accounts.
-- 1) A staff record can be marked «ليس من العاملين» (a test account, or the body that supervises the school):
--    it keeps its login but never appears in staff attendance, evaluations, timetables, substitutes or staff transport.
-- 2) An account can be «جهة مشرفة (مشاهدة وتصدير فقط)»: the manager's role (it sees what the manager sees) with read_only set,
--    so it can write nothing at all, not even what the manager may edit (staff attendance and official hours).
--    This is enforced here, on every table, not only by hiding buttons on the page.
-- Run this file once in the Supabase SQL Editor, after schema.sql, manager.sql and staff_attendance.sql. Safe to re-run.
-- It does not change existing data. Tables added later: re-run this file so they get the same block.

alter table public.teachers add column if not exists not_staff boolean not null default false;
alter table public.profiles add column if not exists read_only boolean not null default false;

-- Only the superadmin changes profiles already (profiles_update in schema.sql), so nobody can lift their own read_only.

create or replace function public.my_read_only() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select read_only from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.my_read_only() from public, anon;
grant execute on function public.my_read_only() to authenticated;

-- A restrictive policy is added (AND) to whatever the table already allows: a read-only account can still read
-- what its role reads, and can never insert, update or delete. Functions that run as their owner (the bots, the
-- links) are not affected.
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists read_only_no_insert on public.%I', t);
    execute format('create policy read_only_no_insert on public.%I as restrictive for insert to authenticated with check (not public.my_read_only())', t);
    execute format('drop policy if exists read_only_no_update on public.%I', t);
    execute format('create policy read_only_no_update on public.%I as restrictive for update to authenticated using (not public.my_read_only()) with check (not public.my_read_only())', t);
    execute format('drop policy if exists read_only_no_delete on public.%I', t);
    execute format('create policy read_only_no_delete on public.%I as restrictive for delete to authenticated using (not public.my_read_only())', t);
  end loop;
end $$;



-- ================================================================
-- parent_links.sql
-- ================================================================
-- رابط خاص لكل ولي أمر (parent.html?t=…): يرى منه أبناءه المسجلين فقط — غيابهم، وإيصالات المواصلات، وجدول حصص شعبهم — دون حساب.
-- ولي الأمر يُعرَف برقم هويته في ملف التسجيل، وإن لم يوجد فبرقم الجوال، وإلا فالرابط للطالب وحده.
-- يُنشئ المدير العام الروابط ويلغيها من شاشة «روابط أولياء الأمور»؛ وكل شيء يمر عبر الدوال أدناه.
-- لا يظهر في الرابط أي رقم هاتف أو هوية، ولا بيانات أي طالب آخر.
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد attendance.sql و timetable.sql و transport_cycles.sql). لا يغيّر أي بيانات موجودة.

-- مفتاح ولي الأمر لطالب: 'id:' + رقم الهوية، أو 'tel:' + الجوال بصيغة الواتساب، أو 'st:' + معرّف الطالب.
-- يجب أن يطابق guardianKey() في index.html
create or replace function public.parent_key(p_details jsonb, p_phone text, p_id uuid) returns text
language sql immutable as $$
  with d as (
    select regexp_replace(translate(coalesce(p_details ->> 'guardian_id', ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') as gid,
           regexp_replace(translate(coalesce(p_phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') as tel
  )
  select case
    when length(gid) >= 5 then 'id:' || gid
    when length(tel) >= 8 then 'tel:' || case when tel ~ '^0[0-9]{10}$' then '2' || tel when tel ~ '^00' then substr(tel, 3) else tel end
    else 'st:' || p_id::text end
  from d
$$;

create table if not exists public.parent_links (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  guardian_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen timestamptz,          -- آخر فتح للرابط
  views int not null default 0
);

alter table public.parent_links enable row level security;
revoke all on public.parent_links from anon;
grant select, insert, update, delete on public.parent_links to authenticated;
drop policy if exists parent_links_admin on public.parent_links;
create policy parent_links_admin on public.parent_links
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

-- ما يراه ولي الأمر. يبدأ العام الدراسي في سبتمبر
create or replace function public.parent_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k text;
  y0 date := make_date(extract(year from (now() at time zone 'Africa/Cairo'))::int - case when extract(month from (now() at time zone 'Africa/Cairo')) < 9 then 1 else 0 end, 9, 1);
  kids jsonb;
  cfg record;
begin
  select guardian_key into k from parent_links where token = p_token and active;
  if k is null then return jsonb_build_object('error', 'الرابط غير صالح أو أُلغي. تواصل مع إدارة الأكاديمية.'); end if;
  update parent_links set last_seen = now(), views = views + 1 where token = p_token;

  select coalesce(to_jsonb(c.days), '[]'::jsonb) as days, coalesce(c.bells, '{}'::jsonb) as bells into cfg from timetable_config c where c.id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', s.full_name,
      'class_name', s.class_name,
      'absences', (select coalesce(jsonb_agg(a.day order by a.day desc), '[]'::jsonb)
                   from attendance a where a.student_id = s.id and a.day >= y0 and a.status in ('absent', 'excused')),
      'recorded_days', (select count(*) from attendance a where a.student_id = s.id and a.day >= y0),
      'bus', (select g.assembly_point from transport_members m join transport_groups g on g.id = m.group_id where m.student_id = s.id),
      -- الإيصالات: الأول بمبلغه الأول (قبل الإيصالات المكمِّلة)، ثم المكمِّلة؛ والمتبقي عن الشهر إن كان مطلوبه مسجّلًا
      'months', (select coalesce(jsonb_agg(jsonb_build_object(
                    'month', p.month, 'paid', p.amount, 'due', to_jsonb(p) -> 'due',
                    'from', public.transport_cycle(p.month) -> 'from', 'to', public.transport_cycle(p.month) -> 'to',   -- الدورة (transport_cycles.sql)
                    'receipts', (select jsonb_agg(r order by (r ->> 'no')::bigint) from (
                        select jsonb_build_object('no', p.receipt_no, 'amount',
                                 coalesce((select t.paid_before from transport_topups t where t.student_id = p.student_id and t.month = p.month order by t.receipt_no limit 1), p.amount),
                                 'on', p.paid_on) as r
                        union all
                        select jsonb_build_object('no', t.receipt_no, 'amount', t.amount, 'on', t.paid_on)
                        from transport_topups t where t.student_id = p.student_id and t.month = p.month) x)
                  ) order by p.month desc), '[]'::jsonb)
                 from transport_payments p where p.student_id = s.id and p.amount > 0 and p.month >= to_char(y0, 'YYYY-MM')),
      'timetable', (select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'period', t.period, 'subject', t.subject, 'teacher', coalesce(te.name, ''))
                    order by t.day, t.period), '[]'::jsonb)
                    from timetable_sessions t left join teachers te on te.id = t.teacher_id
                    where t.class_name = s.class_name and t.status <> 'removed')
    ) order by s.full_name), '[]'::jsonb)
  into kids
  from students s
  where s.status in ('final', 'reserve') and public.parent_key(s.details, s.phone, s.id) = k;

  return jsonb_build_object('school', coalesce((select nullif(to_jsonb(st) ->> 'school_name', '') from settings st where st.id = 1), 'أكاديمية الركيزة الثالثة'),
    'since', y0, 'days', cfg.days, 'bells', cfg.bells, 'children', kids);
end $$;

revoke all on function public.parent_view(text) from public;
grant execute on function public.parent_view(text) to anon, authenticated;



-- ================================================================
-- payment_claims.sql
-- ================================================================
-- المطالبات المالية (المالية): دفع مبلغ لشخص استُعين به أو اشتُري منه شيء بلا فاتورة.
-- اسم المستفيد، وما أنجزه أو الأصناف المشتراة بمبالغها، والتاريخ، وتُطبع سندًا بتوقيع المستلم ومسلِّم المبلغ والمدير.
-- يُنشئها المدير العام، ويراها المدير. شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  no serial,
  claim_date date not null default current_date,
  payee text not null,                       -- اسم المستفيد (من سيستلم المبلغ)
  payee_id text not null default '',         -- رقم الهوية أو الجوال (اختياري)
  kind text not null default 'service',      -- service: خدمة/عمل أنجزه، purchase: أصناف اشتُريت
  description text not null default '',
  items jsonb not null default '[]',         -- [{item, qty, amount}]
  payer text not null default '',            -- مسلِّم المبلغ
  status text not null default 'pending',    -- pending, paid
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_claims enable row level security;
revoke all on public.payment_claims from anon;
grant select, insert, update, delete on public.payment_claims to authenticated;
grant usage on sequence public.payment_claims_no_seq to authenticated;

drop policy if exists payment_claims_edit on public.payment_claims;
create policy payment_claims_edit on public.payment_claims
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists payment_claims_read on public.payment_claims;
create policy payment_claims_read on public.payment_claims
  for select to authenticated using (public.my_role() = 'manager');



-- ================================================================
-- payroll.sql
-- ================================================================
-- الرواتب: «إعدادات الرواتب» و«حساب الرواتب».
--   payroll_setup: راتب كل موظف (من «بيانات العاملين») وقواعد الدوام، شهرًا بشهر. الشهر الذي لم تُحفظ له إعدادات
--                  يعتمد آخر شهر قبله حُفظت إعداداته (يُحسب ذلك في الصفحة).
--   payroll_runs:  الإضافات والخصومات اليدوية لكل شهر، وكشف الشهر كما اعتُمد (لا يتغير بعد الاعتماد بتعديل الدوام أو الرواتب).
--   payroll_access: من يصل إلى الرواتب غير المدير العام (حسابات المدير والمشرف العام): مشاهدة، أو تعديل.
-- المدير العام يرى ويعدّل دائمًا، وهو وحده يمنح الصلاحيات ويلغي اعتماد شهر.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql و staff_attendance.sql)، ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات موجودة.

create table if not exists public.payroll_setup (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  salaries jsonb not null default '{}'::jsonb,   -- { "<teacher_id>": 15000, ... }
  rules jsonb not null default '{}'::jsonb,      -- أيام العمل، التأخير المسموح، الإجازات في فترة، طريقة خصم التأخير، دوام المحفظين
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  can_edit boolean not null default false,
  granted_by text not null default '',
  granted_at timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  adj jsonb not null default '{}'::jsonb,        -- { "<teacher_id>": { "add": 500, "addNote": "...", "ded": 200, "dedNote": "..." } }
  rows jsonb,                                    -- كشف الشهر عند الاعتماد
  rules jsonb,
  approved_by text not null default '',
  approved_at timestamptz,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

-- تغيير راتب موظف خلال الشهر (نصف نصاب ثم نصاب كامل من تاريخ): { "<teacher_id>": { "from": "2026-11-10", "amount": 15000 } }
alter table public.payroll_setup add column if not exists changes jsonb not null default '{}'::jsonb;

-- إظهار سليبات شهر معتمد للموظفين في «دوامي وراتبي»: ممنوع افتراضيًا، ويُظهرها من له تعديل الرواتب
-- (المدير العام، والمدير والمشرف العام إن مُنحوا التعديل) بالدالة set_payroll_slips أدناه
alter table public.payroll_runs add column if not exists show_slip boolean not null default false;

-- صلاحية الحساب الحالي في الرواتب: 'edit' أو 'view' أو ''.
-- حساب «جهة مشرفة» (read_only، من outside_accounts.sql) مشاهدة فقط حتى لو مُنح التعديل
create or replace function public.payroll_level() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  ro boolean := false;
begin
  if public.my_role() = 'superadmin' then return 'edit'; end if;
  if public.my_role() <> 'manager' then return ''; end if;   -- المدير والمشرف العام (دوره manager)؛ لا المشرف التربوي
  if not exists (select 1 from public.payroll_access a where a.user_id = auth.uid()) then return ''; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_only') then
    execute 'select coalesce((select read_only from public.profiles where id = auth.uid()), false)' into ro;
  end if;
  if not ro and exists (select 1 from public.payroll_access a where a.user_id = auth.uid() and a.can_edit) then return 'edit'; end if;
  return 'view';
end;
$$;
revoke all on function public.payroll_level() from public, anon;
grant execute on function public.payroll_level() to authenticated;

alter table public.payroll_setup enable row level security;
alter table public.payroll_access enable row level security;
alter table public.payroll_runs enable row level security;
revoke all on public.payroll_setup, public.payroll_access, public.payroll_runs from anon;
grant select, insert, update, delete on public.payroll_setup, public.payroll_access, public.payroll_runs to authenticated;

drop policy if exists payroll_setup_admin on public.payroll_setup;
drop policy if exists payroll_setup_read on public.payroll_setup;
create policy payroll_setup_read on public.payroll_setup
  for select to authenticated using (public.payroll_level() <> '');
drop policy if exists payroll_setup_write on public.payroll_setup;
create policy payroll_setup_write on public.payroll_setup
  for all to authenticated using (public.payroll_level() = 'edit') with check (public.payroll_level() = 'edit');

drop policy if exists payroll_runs_read on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs
  for select to authenticated using (public.payroll_level() <> '');
-- التعديل: لمن له التعديل، والشهر المعتمد لا يُعدَّل إلا بإلغاء اعتماده، وهذا للمدير العام وحده
drop policy if exists payroll_runs_insert on public.payroll_runs;
create policy payroll_runs_insert on public.payroll_runs
  for insert to authenticated with check (public.payroll_level() = 'edit');
drop policy if exists payroll_runs_update on public.payroll_runs;
create policy payroll_runs_update on public.payroll_runs
  for update to authenticated using (public.payroll_level() = 'edit' and (status = 'draft' or public.my_role() = 'superadmin'))
  with check (public.payroll_level() = 'edit');
drop policy if exists payroll_runs_delete on public.payroll_runs;
create policy payroll_runs_delete on public.payroll_runs
  for delete to authenticated using (public.my_role() = 'superadmin');

drop policy if exists payroll_access_read on public.payroll_access;
create policy payroll_access_read on public.payroll_access
  for select to authenticated using (user_id = auth.uid() or public.my_role() = 'superadmin');
drop policy if exists payroll_access_write on public.payroll_access;
create policy payroll_access_write on public.payroll_access
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

create or replace function public.set_payroll_slips(p_month text, p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.payroll_level() <> 'edit' then raise exception 'لا تملك صلاحية تعديل الرواتب'; end if;
  update public.payroll_runs set show_slip = coalesce(p_show, false) where month = p_month and status = 'approved';
  if not found then raise exception 'رواتب هذا الشهر غير معتمدة'; end if;
end;
$$;
revoke all on function public.set_payroll_slips(text, boolean) from public, anon;
grant execute on function public.set_payroll_slips(text, boolean) to authenticated;

-- «حساب الرواتب» يقرأ «دوام الموظفين» ووقته الرسمي (المدير والمشرف يقرآنه أصلًا؛ هذا لمن أُعطي الرواتب)
do $$
begin
  if to_regclass('public.staff_attendance') is not null then
    drop policy if exists staff_attendance_payroll_read on public.staff_attendance;
    create policy staff_attendance_payroll_read on public.staff_attendance
      for select to authenticated using (public.payroll_level() <> '');
    drop policy if exists staff_hours_payroll_read on public.staff_hours;
    create policy staff_hours_payroll_read on public.staff_hours
      for select to authenticated using (public.payroll_level() <> '');
  end if;
end $$;

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.payroll_setup;
    create trigger audit_row after insert or update or delete on public.payroll_setup for each row execute function public.audit_row('month');
    drop trigger if exists audit_row on public.payroll_runs;
    create trigger audit_row after insert or update or delete on public.payroll_runs for each row execute function public.audit_row('month');
    drop trigger if exists audit_row on public.payroll_access;
    create trigger audit_row after insert or update or delete on public.payroll_access for each row execute function public.audit_row('user_id');
  end if;
end $$;



-- ================================================================
-- principal_gender.sql
-- ================================================================
-- صفة مدير الأكاديمية في التقارير: «مدير الأكاديمية» (m) أو «مديرة الأكاديمية» (f)؛ فارغ = «مدير/ة الأكاديمية».
-- تُختار من «الإعدادات» ← «بيانات المدرسة». شغّل هذا الملف مرة في محرر SQL في Supabase.
alter table public.settings add column if not exists principal_gender text not null default '';



-- ================================================================
-- report_settings.sql
-- ================================================================
-- Text shown in the letterhead and footer of every printed report.
-- Run this file once in the Supabase SQL Editor.

alter table public.settings
  add column if not exists report_subtitle text not null default '',   -- stage / department line under the academy name
  add column if not exists academic_year text not null default '',     -- e.g. 2026/2027; worked out from today's date when empty
  add column if not exists contact_info text not null default '';      -- address, phone, email: printed in the footer



-- ================================================================
-- school_contact.sql
-- ================================================================
-- عنوان الأكاديمية وهاتفها وصفحة فيسبوك: يُعدَّلان من «الإعدادات والمستخدمون» ويظهران أسفل الخطابات الرسمية (الطلبيات).
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.
alter table public.settings add column if not exists school_address text;
alter table public.settings add column if not exists school_phone text;
alter table public.settings add column if not exists school_facebook text;



-- ================================================================
-- signatures.sql
-- ================================================================
-- التوقيع الإلكتروني للأوراق الرسمية، مع حماية من التزوير.
-- كل صاحب توقيع (المدير، المشرف، ...) يرفع صورة توقيعه، ولا يراها غيره ولا مدير النظام إلا عند التوقيع.
-- التوقيع على ورقة: صاحبه بنفسه، أو مدير النظام نيابة عنه؛ وغيرهما يرسل «طلب توقيع» يعتمده صاحب التوقيع.
-- كل ورقة موقّعة تُحفظ هنا برقم ونصّها وبصمتها (SHA-256)، وتُطبع برمز QR يفتح verify.html فيُعرض نصها الأصلي:
-- أي تعديل في الورقة المطبوعة يظهر بالمقارنة، والورقة الملغاة تظهر ملغاة.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.signatures (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  title text not null default '',          -- الصفة: مدير/ة الأكاديمية، المشرف التربوي، ...
  image text not null,                     -- صورة PNG (data URL) بخلفية شفافة
  updated_at timestamptz not null default now()
);

create table if not exists public.sign_requests (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null default auth.uid(),
  requester_name text not null default '',
  signer_id uuid not null references public.signatures (user_id) on delete cascade,
  title text not null default '',
  html text not null,                      -- الورقة كما بُنيت للطباعة
  meta jsonb not null default '{}',        -- تخطيطها (أفقي، العرض، ...)
  body text not null default '',
  hash text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  code text,
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists sign_requests_signer on public.sign_requests (signer_id, status);

create table if not exists public.signed_docs (
  code text primary key,
  title text not null default '',
  body text not null default '',
  hash text not null default '',
  signer_id uuid,
  signer_name text not null default '',
  signer_title text not null default '',
  signed_by uuid,
  signed_by_name text not null default '',
  request_id uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);

alter table public.signatures enable row level security;
alter table public.sign_requests enable row level security;
alter table public.signed_docs enable row level security;
revoke all on public.signatures, public.sign_requests, public.signed_docs from anon;
grant select, insert, update, delete on public.signatures to authenticated;
grant select, insert, delete on public.sign_requests to authenticated;
grant select on public.signed_docs to authenticated;

drop policy if exists sig_own on public.signatures;
create policy sig_own on public.signatures for all to authenticated
  using (user_id = auth.uid() or public.my_role() = 'superadmin')
  with check (user_id = auth.uid() or public.my_role() = 'superadmin');

drop policy if exists sreq_read on public.sign_requests;
create policy sreq_read on public.sign_requests for select to authenticated
  using (requester = auth.uid() or signer_id = auth.uid() or public.my_role() = 'superadmin');
drop policy if exists sreq_insert on public.sign_requests;
create policy sreq_insert on public.sign_requests for insert to authenticated
  with check (requester = auth.uid() and coalesce(public.my_role(), 'pending') <> 'pending' and status = 'pending' and code is null);
drop policy if exists sreq_delete on public.sign_requests;
create policy sreq_delete on public.sign_requests for delete to authenticated
  using (requester = auth.uid() and status = 'pending');

drop policy if exists sdoc_read on public.signed_docs;
create policy sdoc_read on public.signed_docs for select to authenticated
  using (signer_id = auth.uid() or signed_by = auth.uid() or public.my_role() = 'superadmin');

-- أصحاب التوقيعات (بلا الصورة) لقائمة «طلب توقيع من»
create or replace function public.sig_signers() returns table (user_id uuid, name text, title text)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.name, s.title from signatures s where coalesce(public.my_role(), 'pending') <> 'pending' order by s.title, s.name
$$;
grant execute on function public.sig_signers() to authenticated;

-- التوقيع: صاحب التوقيع أو مدير النظام. مع p_request يُوقَّع طلب قائم (بنصه هو لا بنص يرسله المتصل)
create or replace function public.sign_doc(p_signer uuid, p_title text, p_body text, p_hash text, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s signatures; rq sign_requests; c text; me text;
begin
  if p_signer is distinct from auth.uid() and coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'التوقيع لصاحبه أو لمدير النظام فقط'; end if;
  select * into s from signatures where user_id = p_signer;
  if s.user_id is null then raise exception 'لم يُرفع توقيع لهذا الحساب'; end if;
  select coalesce(nullif(full_name, ''), email, '') into me from profiles where id = auth.uid();
  if p_request is not null then
    select * into rq from sign_requests where id = p_request for update;
    if rq.id is null or rq.status <> 'pending' or rq.signer_id <> p_signer then raise exception 'الطلب غير موجود أو بُتّ فيه'; end if;
    p_title := rq.title; p_body := rq.body; p_hash := rq.hash;
  end if;
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from signed_docs where code = c);
  end loop;
  insert into signed_docs (code, title, body, hash, signer_id, signer_name, signer_title, signed_by, signed_by_name, request_id)
  values (c, left(coalesce(p_title, ''), 300), left(coalesce(p_body, ''), 20000), coalesce(p_hash, ''), s.user_id, s.name, s.title, auth.uid(), coalesce(me, ''), p_request);
  if p_request is not null then
    update sign_requests set status = 'approved', code = c, decided_at = now() where id = p_request;
    return jsonb_build_object('code', c);
  end if;
  return jsonb_build_object('code', c, 'image', s.image, 'name', s.name, 'title', s.title, 'at', now());
end $$;
grant execute on function public.sign_doc(uuid, text, text, text, uuid) to authenticated;

create or replace function public.sig_reject(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update sign_requests set status = 'rejected', note = left(coalesce(p_note, ''), 500), decided_at = now()
  where id = p_request and status = 'pending' and (signer_id = auth.uid() or public.my_role() = 'superadmin');
  if not found then raise exception 'الطلب غير موجود أو بُتّ فيه'; end if;
end $$;
grant execute on function public.sig_reject(uuid, text) to authenticated;

-- طباعة طلب معتمد: لصاحب الطلب (أو صاحب التوقيع أو مدير النظام)، ومعه صورة التوقيع
create or replace function public.sig_request_print(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rq sign_requests; d signed_docs; s signatures;
begin
  select * into rq from sign_requests where id = p_id;
  if rq.id is null or rq.status <> 'approved' then raise exception 'الطلب لم يُعتمد'; end if;
  if rq.requester <> auth.uid() and rq.signer_id <> auth.uid() and coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'غير مسموح'; end if;
  select * into d from signed_docs where code = rq.code;
  if d.revoked_at is not null then raise exception 'أُلغيت هذه الورقة'; end if;
  select * into s from signatures where user_id = rq.signer_id;
  return jsonb_build_object('code', d.code, 'image', s.image, 'name', d.signer_name, 'title', d.signer_title, 'at', d.created_at, 'html', rq.html, 'meta', rq.meta);
end $$;
grant execute on function public.sig_request_print(uuid) to authenticated;

create or replace function public.sig_revoke(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update signed_docs set revoked_at = now(), revoked_by = (select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid())
  where code = p_code and revoked_at is null and (signer_id = auth.uid() or public.my_role() = 'superadmin');
  if not found then raise exception 'الورقة غير موجودة أو ملغاة من قبل'; end if;
end $$;
grant execute on function public.sig_revoke(text) to authenticated;

-- صفحة التحقق العامة (بلا تسجيل دخول): نص الورقة الأصلي ومن وقّعها ومتى، وهل أُلغيت. لا تُرجع صورة التوقيع
create or replace function public.verify_doc(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'title', title, 'body', body, 'hash', hash, 'signer_name', signer_name, 'signer_title', signer_title,
    'at', created_at, 'revoked', revoked_at is not null, 'revoked_at', revoked_at)
  from signed_docs where code = upper(trim(p_code))
$$;
grant execute on function public.verify_doc(text) to anon, authenticated;



-- ================================================================
-- staff.sql
-- ================================================================
-- Staff records: the teachers table now holds every staff member (administration, teaching staff,
-- Quran teachers, support services), each with a category, a job title and a WhatsApp number.
-- Only teaching staff appear in the teacher evaluation screens.
-- Run this file once in the Supabase SQL Editor, after teacher_accounts.sql. It does not change existing data
-- (existing rows become "هيئة تدريس").

alter table public.teachers
  add column if not exists category text not null default 'هيئة تدريس'
    check (category in ('إدارية', 'هيئة تدريس', 'محفظون', 'خدمات مساندة', 'خدمات معاونة')),
  add column if not exists job_title text not null default '',
  add column if not exists whatsapp text not null default '';



-- ================================================================
-- staff_attendance.sql
-- ================================================================
-- دوام الموظفين: حضور كل العاملين (من «بيانات العاملين») وانصرافهم بالوقت، يومًا بيوم.
-- يسجّله المدير العام والمدير؛ ويقرؤه المشرف التربوي أيضًا (ليرى غياب المعلمين في شاشة الاحتياط).
-- الوقت الرسمي للحضور والانصراف واحد للجميع، في staff_hours، وبه يُحسب التأخير والانصراف المبكر.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql)، ويمكن تشغيله مرة أخرى بعد أي تحديث له. لا يغيّر أي بيانات موجودة.

-- مدة العمل: يُحسب دوام الموظف من «تاريخ التعيين» (hire_date، من teacher_accounts.sql) إلى «تاريخ انتهاء العقد» (آخر يوم عمل)، إن وُجدا
alter table public.teachers
  add column if not exists contract_end date;

create table if not exists public.staff_attendance (
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  day date not null,
  status text not null default 'present' check (status in ('present', 'absent', 'leave', 'mission')),   -- حاضر، غائب، إجازة، مأمورية
  time_in time,
  time_out time,
  note text not null default '',
  recorded_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (teacher_id, day)
);
create index if not exists staff_attendance_day_idx on public.staff_attendance (day);

create table if not exists public.staff_hours (
  id int primary key default 1 check (id = 1),
  time_in time not null default '07:30',
  time_out time not null default '13:30',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.staff_hours (id) values (1) on conflict (id) do nothing;

alter table public.staff_attendance enable row level security;
alter table public.staff_hours enable row level security;
revoke all on public.staff_attendance, public.staff_hours from anon;
grant select, insert, update, delete on public.staff_attendance to authenticated;
grant select, update on public.staff_hours to authenticated;

drop policy if exists staff_attendance_read on public.staff_attendance;
create policy staff_attendance_read on public.staff_attendance
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists staff_attendance_write on public.staff_attendance;
create policy staff_attendance_write on public.staff_attendance
  for all to authenticated using (public.my_role() in ('superadmin', 'manager')) with check (public.my_role() in ('superadmin', 'manager'));

drop policy if exists staff_hours_read on public.staff_hours;
create policy staff_hours_read on public.staff_hours
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists staff_hours_write on public.staff_hours;
create policy staff_hours_write on public.staff_hours
  for update to authenticated using (public.my_role() in ('superadmin', 'manager')) with check (public.my_role() in ('superadmin', 'manager'));

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.staff_attendance;
    create trigger audit_row after insert or update or delete on public.staff_attendance for each row execute function public.audit_row('teacher_id', 'day');
    drop trigger if exists audit_row on public.staff_hours;
    create trigger audit_row after insert or update or delete on public.staff_hours for each row execute function public.audit_row('id');
  end if;
end $$;



-- ================================================================
-- staff_files.sql
-- ================================================================
-- ملفات العاملين (السير الذاتية، الشهادات، الخبرات، ...): الملفات نفسها في Cloudflare R2، وهنا سجل صغير لكل ملف فقط.
-- الرفع والفتح بروابط مؤقتة من دالة staff-files (مفاتيح R2 فيها لا في الصفحة). يرى الملفات ويديرها المدير العام والمدير.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.staff_files (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.teachers (id) on delete cascade,
  kind text not null default 'cv',       -- cv, cv_all (سيرة وملحقات), degree, experience, course, id, contract, other
  name text not null,                    -- اسم الملف الأصلي
  object_key text not null unique,       -- مساره في R2: staff/<staff_id>/<id>-<name>
  size bigint,
  mime text,
  note text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text
);
create index if not exists staff_files_staff on public.staff_files (staff_id);

alter table public.staff_files enable row level security;
revoke all on public.staff_files from anon;
grant select, insert, update, delete on public.staff_files to authenticated;
drop policy if exists staff_files_rw on public.staff_files;
create policy staff_files_rw on public.staff_files for all to authenticated
  using (public.my_role() in ('superadmin', 'manager'))
  with check (public.my_role() in ('superadmin', 'manager') and not coalesce(public.my_read_only(), false));



-- ================================================================
-- staff_perms.sql
-- ================================================================
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



-- ================================================================
-- staff_profiles.sql
-- ================================================================
-- بطاقة مؤهلات موحّدة لكل موظف، مستخرجة من ملفاته (السيرة الذاتية والشهادات) بدالة read-staff-cv ثم مراجَعة في الموقع.
-- يراها ويعدّلها المدير العام والمدير. شغّله بعد staff_files.sql. لا يغيّر أي بيانات موجودة.

create table if not exists public.staff_profiles (
  staff_id uuid primary key references public.teachers (id) on delete cascade,
  data jsonb not null default '{}',     -- المؤهل، التخصص، الجامعة، سنة التخرج، الخبرات، الدورات، اللغات ... (انظر index.html: SP_FIELDS)
  files jsonb not null default '[]',    -- الملفات التي قُرئت ووصف صفحاتها
  model text,
  read_at timestamptz,
  reviewed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon;
grant select, insert, update, delete on public.staff_profiles to authenticated;
drop policy if exists staff_profiles_rw on public.staff_profiles;
create policy staff_profiles_rw on public.staff_profiles for all to authenticated
  using (public.my_role() in ('superadmin', 'manager'))
  with check (public.my_role() in ('superadmin', 'manager') and not coalesce(public.my_read_only(), false));



-- ================================================================
-- staff_self.sql
-- ================================================================
-- «دوامي وراتبي»: كل حساب مربوط بسجل في «بيانات العاملين» يرى دوامه هو فقط، شهرًا بشهر (الحضور والغياب والإجازات والتأخير
-- بحسب مجموعة دوامه)، وسليب راتبه للشهر المعتمد إن أظهر المسؤول سليبات ذلك الشهر (ممنوعة افتراضيًا). لا يرى دوام غيره ولا رواتبهم.
-- الحساب مربوط بسجله إن كان profiles.teacher_id له، أو teachers.user_id يشير إليه.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff_attendance.sql، ويُفضّل بعد staff_shifts.sql و payroll.sql)، ويمكن تشغيله مرة أخرى.

create or replace function public.my_staff_month(p_month text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid;
  tname text;
  h jsonb;
  shift jsonb;
  g jsonb;
  days jsonb := '[]'::jsonb;
  slip jsonb;
  rules jsonb;
begin
  select coalesce(p.teacher_id, (select t.id from public.teachers t where t.user_id = auth.uid() limit 1)) into tid
    from public.profiles p where p.id = auth.uid();
  if tid is null then return null; end if;
  select name into tname from public.teachers where id = tid;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('id', tid, 'name', tname);
  end if;

  -- دوامه: مجموعته إن كانت له، وإلا الوقت الرسمي
  if to_regclass('public.staff_hours') is not null then
    select to_jsonb(x) into h from public.staff_hours x where x.id = 1;
  end if;
  shift := jsonb_build_object('name', 'الوقت الرسمي', 'time_in', left(coalesce(h->>'time_in', '07:30'), 5), 'time_out', left(coalesce(h->>'time_out', '13:30'), 5));
  if h ? 'assign' and (h->'assign') ? tid::text then
    for g in select * from jsonb_array_elements(coalesce(h->'groups', '[]'::jsonb)) loop
      if g->>'id' = h->'assign'->>tid::text then
        shift := jsonb_build_object('name', g->>'name', 'time_in', g->>'time_in', 'time_out', g->>'time_out');
      end if;
    end loop;
  end if;

  if to_regclass('public.staff_attendance') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'status', a.status, 'time_in', left(a.time_in::text, 5), 'time_out', left(a.time_out::text, 5), 'note', a.note) order by a.day), '[]'::jsonb)
      into days from public.staff_attendance a
     where a.teacher_id = tid and to_char(a.day, 'YYYY-MM') = p_month;
  end if;

  -- سليبه من كشف الشهر المعتمد، وفقط إن أُظهرت سليبات ذلك الشهر للموظفين (show_slip، ممنوعة افتراضيًا)
  if to_regclass('public.payroll_runs') is not null then
    execute 'select e, r.rules from public.payroll_runs r, jsonb_array_elements(coalesce(r.rows, ''[]''::jsonb)) e
              where r.month = $1 and r.status = ''approved'' and coalesce(r.show_slip, false) and e->>''id'' = $2 limit 1'
      into slip, rules using p_month, tid::text;
  end if;

  return jsonb_build_object('id', tid, 'name', tname, 'month', p_month, 'shift', shift, 'days', days, 'slip', slip,
    'rules', case when rules is null then null else jsonb_build_object('work_days', rules->'work_days', 'signer_title', rules->'signer_title', 'signer_name', rules->'signer_name') end);
end;
$$;
revoke all on function public.my_staff_month(text) from public, anon;
grant execute on function public.my_staff_month(text) to authenticated;



-- ================================================================
-- staff_shifts.sql
-- ================================================================
-- مجموعات الدوام في «دوام الموظفين»: لكل مجموعة اسم ووقت حضور وانصراف، ولكل موظف مجموعته.
-- من لا مجموعة له فدوامه الوقت الرسمي (time_in / time_out). بها يُحسب التأخير والانصراف المبكر والحضور والانصراف الموحدان وأجر الساعة في الرواتب.
--   groups: [ { "id": "g…", "name": "المحفظون", "time_in": "08:00", "time_out": "10:00" }, … ]
--   assign: { "<teacher_id>": "g…", … }
-- يعدّلها من يعدّل الوقت الرسمي (المدير العام والمدير). شغّل هذا الملف في محرر SQL في Supabase (بعد staff_attendance.sql)،
-- ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات موجودة.

alter table public.staff_hours
  add column if not exists groups jsonb not null default '[]'::jsonb,
  add column if not exists assign jsonb not null default '{}'::jsonb;



-- ================================================================
-- staff_warnings.sql
-- ================================================================
-- التنبيهات المكتوبة للموظفين («دوام الموظفين» ← «الكتب» ← «كتاب تنبيه» ← «حفظ في ملف الموظف»).
-- يُحفظ نص التنبيه نفسه، فيظهر في بطاقة الموظف ويُعاد طباعته كما صدر. يراها ويديرها المدير العام والمدير.
-- شغّل هذا الملف مرة في محرر SQL في Supabase.

create table if not exists public.staff_warnings (
  id uuid primary key default gen_random_uuid(),
  no serial,
  staff_id uuid not null references public.teachers (id) on delete cascade,
  letter_date date not null default current_date,
  subject text not null default 'تنبيه',
  salutation text not null default '',
  body text not null default '',
  supervisor text not null default '',
  principal text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists staff_warnings_staff on public.staff_warnings (staff_id);

alter table public.staff_warnings enable row level security;
revoke all on public.staff_warnings from anon;
grant select, insert, update, delete on public.staff_warnings to authenticated;
drop policy if exists staff_warnings_rw on public.staff_warnings;
create policy staff_warnings_rw on public.staff_warnings for all to authenticated
  using (public.my_role() in ('superadmin', 'manager'))
  with check (public.my_role() in ('superadmin', 'manager') and not coalesce(public.my_read_only(), false));

-- يُسجَّل في سجل التعديلات إن كان مُفعّلًا (supabase/audit_log.sql)
do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.staff_warnings;
    create trigger audit_row after insert or update or delete on public.staff_warnings for each row execute function public.audit_row('no');
  end if;
end $$;



-- ================================================================
-- student_lists.sql
-- ================================================================
-- قوائم الطلاب العامة (شئون الطلاب): قائمة لها عنوان (مثل «الموافقون على تطعيم الحصبة») ويُختار فيها طلاب،
-- وتُطبع كشفًا حسب الشعبة للمختارين أو لغير المختارين. تُستعمل لأي غرض: تطعيم، رحلة، نشاط، استلام كتب...
-- يعدّلها المدير العام والمسجِّل، ويراها المدير والمشرف. شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.student_lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  yes_label text not null default 'وافق',       -- وصف المختارين في الكشف المطبوع
  no_label text not null default 'لم يوافق',    -- وصف غير المختارين
  notes text not null default '',
  student_ids uuid[] not null default '{}',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_lists enable row level security;
revoke all on public.student_lists from anon;
grant select, insert, update, delete on public.student_lists to authenticated;

drop policy if exists student_lists_edit on public.student_lists;
create policy student_lists_edit on public.student_lists
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_lists_read on public.student_lists;
create policy student_lists_read on public.student_lists
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));



-- ================================================================
-- students.sql
-- ================================================================
-- Student registration.
-- Run this file once in the Supabase SQL Editor, after the other scripts.

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  national_id text not null unique,
  phone text not null default '',
  whatsapp text not null default '',
  birth_date date,
  address text not null default '',
  class_name text not null default '',          -- one of the school's classes (settings.classes); '' = not assigned yet
  has_prev_certificate boolean,
  prev_grade text not null default '',
  guardian_name text not null default '',
  guardian_relation text not null default '',
  guardian_job text not null default '',
  has_health_condition boolean,
  takes_medication boolean,
  has_special_needs boolean,
  is_orphan boolean,
  orphan_of text not null default '',
  memorizes_quran boolean,
  quran_parts numeric,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists students_class_idx on public.students (class_name);

alter table public.students enable row level security;
revoke all on public.students from anon;
grant select, insert, update, delete on public.students to authenticated;

-- Student records hold personal and health information: the superadmin only.
drop policy if exists students_admin on public.students;
create policy students_admin on public.students
  for all to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');



-- ================================================================
-- substitutes.sql
-- ================================================================
-- حصص الاحتياط: غياب المعلمين (يومًا كاملًا أو حصصًا منه)، ومن يغطي كل حصة من حصصهم.
-- يسجّلها المدير العام والمشرف التربوي من «جدول الحصص ← الاحتياط»، ويراها المدير.
-- صفحة الممر (bells.html) تعرض احتياط اليوم: الشعبة والحصة والمادة واسم المعلم البديل فقط.
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد timetable.sql). لا يغيّر أي بيانات موجودة.

create table if not exists public.teacher_absences (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  periods smallint[],                   -- فارغ: اليوم كله؛ وإلا أرقام الحصص التي يغيبها
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (day, teacher_id)
);
create index if not exists teacher_absences_day_idx on public.teacher_absences (day);

create table if not exists public.substitutions (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  period smallint not null check (period between 1 and 12),
  class_name text not null,
  subject text not null default '',
  absent_teacher_id uuid references public.teachers (id) on delete set null,
  sub_teacher_id uuid references public.teachers (id) on delete set null,   -- فارغ: لم يُحدَّد بديل بعد
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (day, class_name, period)
);
create index if not exists substitutions_day_idx on public.substitutions (day);

alter table public.teacher_absences enable row level security;
alter table public.substitutions enable row level security;
revoke all on public.teacher_absences, public.substitutions from anon;
grant select, insert, update, delete on public.teacher_absences, public.substitutions to authenticated;

drop policy if exists teacher_absences_read on public.teacher_absences;
create policy teacher_absences_read on public.teacher_absences
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists teacher_absences_write on public.teacher_absences;
create policy teacher_absences_write on public.teacher_absences
  for all to authenticated using (public.my_role() in ('superadmin', 'supervisor')) with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists substitutions_read on public.substitutions;
create policy substitutions_read on public.substitutions
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists substitutions_write on public.substitutions;
create policy substitutions_write on public.substitutions
  for all to authenticated using (public.my_role() in ('superadmin', 'supervisor')) with check (public.my_role() in ('superadmin', 'supervisor'));

-- احتياط اليوم لصفحة الممر: بلا اسم المعلم الغائب ولا سبب غيابه
create or replace function public.public_subs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('period', s.period, 'class_name', s.class_name, 'subject', s.subject, 'teacher', t.name)
           order by s.period, s.class_name), '[]'::jsonb)
  from substitutions s join teachers t on t.id = s.sub_teacher_id
  where s.day = (now() at time zone 'Africa/Cairo')::date
$$;
revoke all on function public.public_subs() from public;
grant execute on function public.public_subs() to anon, authenticated;

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql): يشمل الجدولين الجديدين
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.teacher_absences;
    create trigger audit_row after insert or update or delete on public.teacher_absences for each row execute function public.audit_row('teacher_id', 'day');
    drop trigger if exists audit_row on public.substitutions;
    create trigger audit_row after insert or update or delete on public.substitutions for each row execute function public.audit_row('class_name', 'day', 'period');
  end if;
end $$;



-- ================================================================
-- supervisor_name.sql
-- ================================================================
-- اسم المشرف التربوي: يُكتب في «الإعدادات» ← «بيانات المدرسة»، ويظهر ثلاثيًا في خانة توقيع المشرف التربوي
-- (إنذار الطالب، سجل المخالفات المطبوع، تنبيه العاملين). شغّل هذا الملف مرة في محرر SQL في Supabase.
alter table public.settings add column if not exists supervisor_name text not null default '';



-- ================================================================
-- teacher_accounts.sql
-- ================================================================
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
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin'));

alter table public.profiles
  add column if not exists teacher_id uuid references public.teachers (id) on delete set null,
  add column if not exists must_change_password boolean not null default false;

-- ---------- School settings ----------

alter table public.settings
  add column if not exists principal_name text not null default 'أ. سمر أبو مدين',
  add column if not exists classes jsonb not null default '[]'::jsonb;   -- the school's classes and sections

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

-- النسخة المعتمدة من get_results في registrar.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'get_results' and pronamespace = 'public'::regnamespace) then
    execute $fn$
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
$$
    $fn$;
  end if;
end $guard$;



-- ================================================================
-- teacher_papers.sql
-- ================================================================
-- أوراق العمل والاختبارات: يُعدّها المعلم في الموقع (المحتوى فقط) وتُطبع بقالب الأكاديمية الرسمي.
-- كل معلم يرى أوراقه، ويختار نشر الورقة (public) فيراها زملاؤه، أو إبقاءها خاصة (private).
-- المدير العام والمدير والمشرف التربوي يرون كل الأوراق؛ والمشرف التربوي يعتمد أو يعيد للتعديل حين يُفعَّل الاعتماد.
-- وفيه أيضًا my_staff_cv(): السيرة الذاتية للمعلم نفسه في صفحة «دوامي وراتبي».
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد staff_self.sql، ويُفضّل بعد staff_cv.sql). لا يغيّر أي بيانات موجودة.

-- سجل العامل المربوط بالحساب الحالي (كما في my_staff_month)
create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p.teacher_id, (select t.id from teachers t where t.user_id = auth.uid() limit 1))
  from profiles p where p.id = auth.uid()
$$;
grant execute on function public.my_teacher_id() to authenticated;

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  kind text not null default 'worksheet' check (kind in ('worksheet', 'quiz', 'monthly', 'midterm', 'final')),
  subject text not null default '',
  class_name text not null default '',
  lesson text not null default '',          -- الدرس أو الوحدة
  term text not null default '',            -- الفصل الدراسي
  paper_date date,
  duration text not null default '',        -- زمن الاختبار
  instructions text not null default '',
  items jsonb not null default '[]',        -- [{title, points, body, lines}] الأنشطة أو الأسئلة بالترتيب
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists papers_teacher on public.papers (teacher_id, updated_at desc);

-- إعداد واحد: هل الاعتماد مفعَّل (معطَّل حتى يفعّله المدير العام)
create table if not exists public.paper_settings (
  id int primary key default 1 check (id = 1),
  review_enabled boolean not null default false
);
insert into public.paper_settings (id) values (1) on conflict (id) do nothing;

alter table public.papers enable row level security;
alter table public.paper_settings enable row level security;
revoke all on public.papers, public.paper_settings from anon;
grant select, insert, update, delete on public.papers to authenticated;
grant select, update on public.paper_settings to authenticated;

drop policy if exists papers_read on public.papers;
create policy papers_read on public.papers for select to authenticated using (
  teacher_id = public.my_teacher_id()
  or (visibility = 'public' and public.my_teacher_id() is not null)
  or public.my_role() in ('superadmin', 'manager', 'supervisor'));

-- المعلم يكتب أوراقه هو؛ والمدير العام كل الأوراق؛ والمشرف التربوي يعدّل حالة المراجعة (يمنع الـ trigger غير ذلك)
drop policy if exists papers_insert on public.papers;
create policy papers_insert on public.papers for insert to authenticated with check (
  (teacher_id = public.my_teacher_id() or public.my_role() = 'superadmin') and not coalesce(public.my_read_only(), false));
drop policy if exists papers_update on public.papers;
create policy papers_update on public.papers for update to authenticated
  using (teacher_id = public.my_teacher_id() or public.my_role() in ('superadmin', 'supervisor'))
  with check (not coalesce(public.my_read_only(), false));
drop policy if exists papers_delete on public.papers;
create policy papers_delete on public.papers for delete to authenticated using (
  (teacher_id = public.my_teacher_id() and status <> 'approved') or public.my_role() = 'superadmin');

drop policy if exists paper_settings_read on public.paper_settings;
create policy paper_settings_read on public.paper_settings for select to authenticated using (true);
drop policy if exists paper_settings_write on public.paper_settings;
create policy paper_settings_write on public.paper_settings for update to authenticated using (public.my_role() = 'superadmin');

-- الاعتماد والإعادة للمشرف التربوي والمدير العام فقط؛ والمعلم لا يعتمد ورقته. المشرف لا يغيّر محتوى ورقة غيره.
-- تعديل المعلم لورقة معتمدة أو معادة يعيدها مسودة.
create or replace function public.papers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare reviewer boolean := public.my_role() in ('superadmin', 'supervisor'); keep papers;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if not reviewer then new.status := case when new.status = 'submitted' then 'submitted' else 'draft' end; new.review_note := null; new.reviewed_by := null; new.reviewed_at := null; end if;
    return new;
  end if;
  if new.status in ('approved', 'returned') and new.status is distinct from old.status and not reviewer then
    raise exception 'الاعتماد للمشرف التربوي';
  end if;
  if public.my_role() = 'supervisor' and old.teacher_id is distinct from public.my_teacher_id() then
    -- المشرف على ورقة غيره: الحالة والملاحظة فقط
    keep := old;
    keep.status := new.status; keep.review_note := new.review_note; keep.reviewed_by := new.reviewed_by; keep.reviewed_at := new.reviewed_at; keep.updated_at := now();
    return keep;
  end if;
  if not reviewer and old.status in ('approved', 'returned') and (new.items is distinct from old.items or new.instructions is distinct from old.instructions) then
    new.status := 'draft';
  end if;
  return new;
end $$;
drop trigger if exists papers_guard on public.papers;
create trigger papers_guard before insert or update on public.papers for each row execute function public.papers_guard();

-- السيرة الذاتية للعامل نفسه: رابطها إن كان مفعّلًا، وبطاقة مؤهلاته المعتمدة
create or replace function public.my_staff_cv() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.my_teacher_id(); r jsonb;
begin
  if tid is null or to_regclass('public.staff_profiles') is null then return null; end if;
  select to_jsonb(p) into r from staff_profiles p where p.staff_id = tid and p.reviewed;
  if r is null then return null; end if;
  return jsonb_build_object('token', case when coalesce((r ->> 'cv_public')::boolean, false) then r ->> 'cv_token' end,
    'data', (r -> 'data') - 'unsure' - 'pages');
end $$;
grant execute on function public.my_staff_cv() to authenticated;

-- ورقة جاهزة: يرفع المعلم صورة أو PDF لورقة أعدّها من قبل، فتُطبع بترويسة الأكاديمية وتذييلها.
-- الملفات في Cloudflare R2 (دالة staff-files)، وهنا أسماؤها فقط.
alter table public.papers
  add column if not exists mode text not null default 'build',   -- build: محتوى يُكتب في الموقع؛ scan: صور أو PDF جاهزة
  add column if not exists files jsonb not null default '[]';     -- [{key, name, mime, size}]



-- ================================================================
-- teacher_self.sql
-- ================================================================
-- المعلم صاحب الحساب يقرأ سجله هو في «بيانات العاملين» (اسمه ومباحثه وشعبه)، ليظهر له «جدولي».
-- قبل هذا الملف لا يقرأ المعلم أي سجل في teachers، فيظهر له «حسابك غير مربوط بسجل معلم» مع أن حسابه مربوط.
-- لا يرى سجلات غيره، ولا يعدّل شيئًا. شغّل هذا الملف في محرر SQL في Supabase، ويمكن تشغيله مرة أخرى.

drop policy if exists teachers_self_read on public.teachers;
create policy teachers_self_read on public.teachers
  for select to authenticated
  using (public.my_role() = 'teacher' and id = (select p.teacher_id from public.profiles p where p.id = auth.uid()));



-- ================================================================
-- timetable.sql
-- ================================================================
-- Timetable: lessons (day × period × class) with their teacher and subject, and the school-day timings.
-- Teachers are the existing staff records (public.teachers); classes are the class names in the class settings.
-- Edited by the superadmin and supervisors; read by the manager; a teacher with an account reads their own lessons.
-- The bell schedule (timings only, no names) is also readable without signing in, for the corridor screen (bells.html).
-- Run this file once in the Supabase SQL Editor, after staff.sql and manager.sql. It does not change existing data.

create table if not exists public.timetable_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,                        -- the lesson's id in the imported file (s88…): a second import updates, never duplicates
  day smallint not null check (day between 0 and 6),        -- 0 = Sunday
  period smallint not null check (period between 1 and 12), -- ordinal; its time comes from the class's stage
  class_name text not null,
  teacher_id uuid references public.teachers (id) on delete set null,
  subject text not null default '',
  status text not null default 'ok' check (status in ('ok', 'review', 'removed')),  -- removed: kept so it can be restored
  note text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists timetable_sessions_class_idx on public.timetable_sessions (class_name, day, period);
create index if not exists timetable_sessions_teacher_idx on public.timetable_sessions (teacher_id, day, period);

-- One row: days, subjects and the bell schedule per stage.
-- bells = { auto, stages: [{ id, name, classes: [class names], rows: [{ k: 'a'|'p'|'b', l, f, t }] }] }
create table if not exists public.timetable_config (
  id int primary key default 1 check (id = 1),
  days jsonb not null default '["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]'::jsonb,
  subjects jsonb not null default '[]'::jsonb,
  bells jsonb not null default '{"auto": true, "stages": []}'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.timetable_config (id) values (1) on conflict (id) do nothing;

alter table public.timetable_sessions enable row level security;
alter table public.timetable_config enable row level security;
revoke all on public.timetable_sessions, public.timetable_config from anon;
grant select, insert, update, delete on public.timetable_sessions, public.timetable_config to authenticated;

drop policy if exists timetable_sessions_edit on public.timetable_sessions;
create policy timetable_sessions_edit on public.timetable_sessions
  for all to authenticated
  using (public.my_role() in ('superadmin', 'supervisor'))
  with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists timetable_sessions_manager_read on public.timetable_sessions;
create policy timetable_sessions_manager_read on public.timetable_sessions
  for select to authenticated using (public.my_role() = 'manager');

drop policy if exists timetable_sessions_own on public.timetable_sessions;
create policy timetable_sessions_own on public.timetable_sessions
  for select to authenticated
  using (public.my_role() = 'teacher' and teacher_id = (select p.teacher_id from public.profiles p where p.id = auth.uid()));

drop policy if exists timetable_config_edit on public.timetable_config;
create policy timetable_config_edit on public.timetable_config
  for all to authenticated
  using (public.my_role() in ('superadmin', 'supervisor'))
  with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists timetable_config_read on public.timetable_config;
create policy timetable_config_read on public.timetable_config
  for select to authenticated using (public.my_role() in ('manager', 'teacher'));

-- The corridor screen: stage names and timings only.
create or replace function public.public_bells()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('days', days, 'bells', bells) from public.timetable_config where id = 1;
$$;
revoke all on function public.public_bells() from public;
grant execute on function public.public_bells() to anon, authenticated;



-- ================================================================
-- timetable_plan.sql
-- ================================================================
-- Timetable planning: the teaching load (how many weekly lessons of each subject each class has, and with which teacher),
-- the rules of a good teacher timetable, and improvement proposals that wait for approval before they change the timetable.
-- Edited and approved by the superadmin and supervisors; read by the manager.
-- Run this file once in the Supabase SQL Editor, after timetable.sql. It does not change existing data.

alter table public.timetable_config
  add column if not exists quota jsonb not null default '[]'::jsonb,   -- [{ class_name, subject, teacher_id, count }]
  add column if not exists rules jsonb not null default '{}'::jsonb;   -- { run, day, side, gaps: { on, v } }

create table if not exists public.timetable_proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  goal text not null default '',
  teacher_id uuid references public.teachers (id) on delete set null,   -- the teacher whose timetable is improved (empty: everyone)
  changes jsonb not null default '[]'::jsonb,   -- [{ id, from: { d, p }, to: { d, p } }]: lessons moved, with where they were when proposed
  summary jsonb not null default '{}'::jsonb,   -- scores before and after for each affected teacher, for display
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  decided_by text not null default '',
  decided_at timestamptz,
  note text not null default ''
);
create index if not exists timetable_proposals_status_idx on public.timetable_proposals (status, created_at desc);

alter table public.timetable_proposals enable row level security;
revoke all on public.timetable_proposals from anon;
grant select, insert, update, delete on public.timetable_proposals to authenticated;

drop policy if exists timetable_proposals_edit on public.timetable_proposals;
create policy timetable_proposals_edit on public.timetable_proposals
  for all to authenticated
  using (public.my_role() in ('superadmin', 'supervisor'))
  with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists timetable_proposals_manager_read on public.timetable_proposals;
create policy timetable_proposals_manager_read on public.timetable_proposals
  for select to authenticated using (public.my_role() = 'manager');



-- ================================================================
-- transport.sql
-- ================================================================
-- Student transportation: groups by assembly point, their riders, and monthly ride payments.
-- Run this file once in the Supabase SQL Editor, after students.sql.

create table if not exists public.transport_groups (
  id uuid primary key default gen_random_uuid(),
  assembly_point text not null,
  supervisor_name text not null default '',
  supervisor_phone text not null default '',
  pickup_time text not null default '',
  fee numeric not null default 0,               -- each student's monthly share, unless overridden per student
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- A student rides with one group at a time.
create table if not exists public.transport_members (
  student_id uuid primary key references public.students (id) on delete cascade,
  group_id uuid not null references public.transport_groups (id) on delete cascade,
  share numeric,                                -- null = the group's fee
  joined_at timestamptz not null default now()
);
create index if not exists transport_members_group_idx on public.transport_members (group_id);

-- What a student has paid for a given month ("2026-10").
create table if not exists public.transport_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (student_id, month)
);
create index if not exists transport_payments_month_idx on public.transport_payments (month);

alter table public.transport_groups enable row level security;
alter table public.transport_members enable row level security;
alter table public.transport_payments enable row level security;

revoke all on public.transport_groups, public.transport_members, public.transport_payments from anon;
grant select, insert, update, delete on public.transport_groups, public.transport_members, public.transport_payments to authenticated;

-- Like student records: the superadmin only.
drop policy if exists transport_groups_admin on public.transport_groups;
create policy transport_groups_admin on public.transport_groups
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

drop policy if exists transport_members_admin on public.transport_members;
create policy transport_members_admin on public.transport_members
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

drop policy if exists transport_payments_admin on public.transport_payments;
create policy transport_payments_admin on public.transport_payments
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

-- ---------- Payment method and receipts ----------

alter table public.transport_payments
  add column if not exists method text not null default 'cash'
    check (method in ('cash', 'instapay', 'vodafone', 'other')),
  add column if not exists method_note text not null default '',     -- what "other" means
  add column if not exists paid_on date not null default current_date,
  add column if not exists receipt_no bigint generated by default as identity;   -- serial receipt number

alter table public.settings
  add column if not exists school_name text not null default '';     -- printed at the top of receipts

-- Other spellings and names of the same assembly point ("جاردينيا ستي" for "جاردينيا سيتي"),
-- so addresses written either way are recognised as this group.
alter table public.transport_groups add column if not exists aliases jsonb not null default '[]'::jsonb;



-- ================================================================
-- transport_buses.sql
-- ================================================================
-- Buses: each transport group is a bus that follows a route.
-- Adds the driver and capacity of the bus, each student's boarding point, and the payment follow-up:
-- an extra grace date given to a student, and the suspension from riding for a month that was not paid.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

alter table public.transport_groups
  add column if not exists driver_name text,
  add column if not exists driver_phone text,
  add column if not exists capacity integer check (capacity is null or capacity >= 0);

-- رقم الباص والمنطقة وخط السير المفصّل (من جدول خطوط الباصات)
alter table public.transport_groups
  add column if not exists bus_no integer,
  add column if not exists area text not null default '',
  add column if not exists route text not null default '';

alter table public.transport_members
  add column if not exists pickup text,                 -- where the student boards the bus
  add column if not exists grace_until date,            -- extra time to pay, given to this student
  add column if not exists suspended_month text check (suspended_month is null or suspended_month ~ '^\d{4}-\d{2}$'),  -- month the student is suspended for ("2026-11")
  add column if not exists suspended_by text,
  add column if not exists suspended_at timestamptz;



-- ================================================================
-- transport_cycles.sql
-- ================================================================
-- دورات المواصلات: حساب الدورة (بدايتها ونهايتها وموعد سدادها ورسومها) في القاعدة، مطابقًا لـ cycleOf() في index.html.
-- الدورة تُعرف بشهر بدايتها ('2026-11')، والإعداد في settings.classes.cycles = { startDay, graceDays, over: { 'YYYY-MM': { from, to, due, first, next } } }.
-- بلا إعداد: الدورة هي الشهر الميلادي، وموعد السداد يوم «آخر يوم للسداد» القديم منه.
-- تستعملها دوال تطبيق الموبايل (api.sql) ورابط ولي الأمر (parent_links.sql).
-- شغّل هذا الملف في محرر SQL، ثم أعد تشغيل parent_links.sql و api.sql. لا يغيّر أي بيانات.

create or replace function public.transport_num(p jsonb, p_default numeric) returns numeric
language sql immutable as $$
  select case when p is null or jsonb_typeof(p) = 'null' then p_default
              when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then btrim(p #>> '{}')::numeric
              else p_default end
$$;

create or replace function public.transport_iso(p jsonb) returns date
language sql immutable as $$
  select case when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then (p #>> '{}')::date end
$$;

-- '2026-11' + n أشهر
create or replace function public.transport_shift(p_key text, p_n int) returns text
language sql immutable as $$ select to_char((p_key || '-01')::date + make_interval(months => p_n), 'YYYY-MM') $$;

create or replace function public.transport_cycle(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb; f jsonb; cy jsonb; over jsonb; o jsonb; p jsonb; nx jsonb;
  due_day int; sd int; gd int; v numeric;
  frm date; nfrom date; t date; nkey text := public.transport_shift(p_key, 1);
begin
  if p_key !~ '^\d{4}-\d{2}$' then raise exception 'الدورة بصيغة YYYY-MM'; end if;
  select case when jsonb_typeof(s.classes) = 'object' then s.classes end into c from settings s where s.id = 1;
  f := coalesce(c -> 'fees', '{}'::jsonb);
  cy := case when jsonb_typeof(c -> 'cycles') = 'object' then c -> 'cycles' else '{}'::jsonb end;
  over := case when jsonb_typeof(cy -> 'over') = 'object' then cy -> 'over' else '{}'::jsonb end;
  o := coalesce(over -> p_key, '{}'::jsonb);
  p := coalesce(over -> public.transport_shift(p_key, -1), '{}'::jsonb);
  nx := coalesce(over -> nkey, '{}'::jsonb);

  v := public.transport_num(f -> 'dueDay', null);
  due_day := case when v between 1 and 28 then round(v) else 5 end;
  v := public.transport_num(cy -> 'startDay', null);
  sd := case when v between 1 and 28 then round(v) else 1 end;
  v := public.transport_num(cy -> 'graceDays', null);
  gd := case when v between 0 and 27 then round(v) else due_day - 1 end;

  frm := coalesce(public.transport_iso(o -> 'from'), public.transport_iso(p -> 'to') + 1, (p_key || '-' || lpad(sd::text, 2, '0'))::date);
  nfrom := coalesce(public.transport_iso(nx -> 'from'), public.transport_iso(o -> 'to') + 1, (nkey || '-' || lpad(sd::text, 2, '0'))::date);
  t := coalesce(public.transport_iso(o -> 'to'), nfrom - 1);

  return jsonb_build_object('key', p_key, 'from', frm, 'to', t,
    'due', coalesce(public.transport_iso(o -> 'due'), frm + gd),
    'first', public.transport_num(o -> 'first', public.transport_num(f -> 'first', 700)),
    'next', public.transport_num(o -> 'next', public.transport_num(f -> 'next', 600)),
    'custom', o <> '{}'::jsonb);
end $$;

-- الدورة التي يقع فيها اليوم (شهر بدايتها)
create or replace function public.transport_current_cycle(p_day date default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date); k text := to_char(d, 'YYYY-MM'); c jsonb; i int;
begin
  for i in 1 .. 3 loop
    c := public.transport_cycle(k);
    if d < (c ->> 'from')::date then k := public.transport_shift(k, -1);
    elsif d > (c ->> 'to')::date then k := public.transport_shift(k, 1);
    else exit; end if;
  end loop;
  return k;
end $$;

-- تُستدعى من داخل الدوال الأخرى فقط
revoke all on function public.transport_num(jsonb, numeric), public.transport_iso(jsonb), public.transport_shift(text, int),
  public.transport_cycle(text), public.transport_current_cycle(date) from public, anon, authenticated;



-- ================================================================
-- transport_discount.sql
-- ================================================================
-- Transport receipts with a discount: the receipt is issued for the fee after the discount, with the discount and its reason kept on it.
-- The fee due at issue ("due", receipts_due.sql) is the discounted fee, so a receipt that pays it counts as a FULL payment, not a partial one.
-- Existing receipts are not touched. Run receipts_due.sql first, then this file once in the Supabase SQL Editor.

alter table public.transport_payments
  add column if not exists discount numeric not null default 0,
  add column if not exists discount_reason text not null default '';



-- ================================================================
-- transport_issuer.sql
-- ================================================================
-- Who recorded each transport payment (issued the receipt), and when.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data:
-- payments recorded before it show the time of their last change and no name.

alter table public.transport_payments
  add column if not exists issued_by text not null default '',   -- name of the account that recorded the amount
  add column if not exists issued_at timestamptz;                -- when it was recorded



-- ================================================================
-- transport_refunds.sql
-- ================================================================
-- Refunds of transport fees.
-- A refund gives money back from what a student paid for a month: the payment is reduced by the refunded
-- amount (so the collected totals show the net), and the refund itself is recorded here with its own
-- voucher number, who made it, when, how and why.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

create table if not exists public.transport_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no bigint generated by default as identity,   -- serial refund voucher number
  student_id uuid references public.students (id) on delete set null,
  student_name text not null default '',               -- kept as text so the record survives changes to the student
  guardian_name text not null default '',
  class_name text not null default '',
  assembly_point text not null default '',
  month text not null check (month ~ '^\d{4}-\d{2}$'), -- the month the refunded fee was paid for
  receipt_no bigint,                                   -- the receipt the money was paid with
  paid_before numeric not null default 0,              -- paid for the month before this refund
  amount numeric not null check (amount > 0),          -- refunded
  method text not null default 'cash'
    check (method in ('cash', 'instapay', 'vodafone', 'other')),
  method_note text not null default '',
  reason text not null default '',
  refunded_by text not null default '',
  refunded_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transport_refunds_month_idx on public.transport_refunds (month);

alter table public.transport_refunds enable row level security;
revoke all on public.transport_refunds from anon;
grant select, insert, update, delete on public.transport_refunds to authenticated;

-- Like the payments themselves: the superadmin only.
drop policy if exists transport_refunds_admin on public.transport_refunds;
create policy transport_refunds_admin on public.transport_refunds
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');



-- ================================================================
-- transport_staff.sql
-- ================================================================
-- Transport for staff: a staff member (from the staff list, table teachers) can ride a bus and pay for it.
-- Kept apart from the students' tables, so nothing about students, their dues or their receipts changes.
-- A staff receipt takes its number from the same sequence as the students' receipts (one receipt book).
-- There is no fixed fee for staff: the amount is written on each receipt.
-- A receipt is never edited or deleted from the app; a mistaken one is voided (kept, marked, with the reason)
-- and a new one is issued. Written by the superadmin, read by the manager.
-- Run this file once in the Supabase SQL Editor, after transport.sql (and staff.sql, audit_log.sql if used).
-- It does not change existing data.

create table if not exists public.transport_staff_members (
  staff_id uuid primary key references public.teachers (id) on delete cascade,
  group_id uuid not null references public.transport_groups (id) on delete cascade,
  pickup text not null default '',
  left_from text check (left_from is null or left_from ~ '^\d{4}-\d{2}$'),   -- first cycle not riding; null = riding
  joined_at timestamptz not null default now()
);
create index if not exists transport_staff_members_group_idx on public.transport_staff_members (group_id);

create table if not exists public.transport_staff_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint not null,
  staff_id uuid not null references public.teachers (id) on delete restrict,
  staff_name text not null default '',          -- the name as printed on the receipt
  month text not null check (month ~ '^\d{4}-\d{2}$'),   -- the billing cycle (keyed by the month it starts in)
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  method_note text not null default '',
  paid_on date not null default current_date,
  issued_by text not null default '',
  issued_at timestamptz not null default now(),
  voided_at timestamptz,                         -- set once when the receipt is voided; it then counts nowhere
  voided_by text,
  void_reason text
);
create unique index if not exists transport_staff_payments_receipt_idx on public.transport_staff_payments (receipt_no);
create index if not exists transport_staff_payments_month_idx on public.transport_staff_payments (month, staff_id);
create index if not exists transport_staff_payments_paid_idx on public.transport_staff_payments (paid_on);

-- the same numbering as the students' receipts: one sequence, numbers never repeat
do $$
declare
  seq text := pg_get_serial_sequence('public.transport_payments', 'receipt_no');
begin
  execute format('alter table public.transport_staff_payments alter column receipt_no set default nextval(%L::regclass)', seq);
  execute format('grant usage, select on sequence %s to authenticated', seq);   -- Supabase grants this already; explicit for safety
end $$;

alter table public.transport_staff_members enable row level security;
alter table public.transport_staff_payments enable row level security;
revoke all on public.transport_staff_members, public.transport_staff_payments from anon;
grant select, insert, update, delete on public.transport_staff_members, public.transport_staff_payments to authenticated;

drop policy if exists transport_staff_members_admin on public.transport_staff_members;
create policy transport_staff_members_admin on public.transport_staff_members
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_members_manager_read on public.transport_staff_members;
create policy transport_staff_members_manager_read on public.transport_staff_members
  for select to authenticated using (public.my_role() = 'manager');

drop policy if exists transport_staff_payments_admin on public.transport_staff_payments;
create policy transport_staff_payments_admin on public.transport_staff_payments
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_payments_manager_read on public.transport_staff_payments;
create policy transport_staff_payments_manager_read on public.transport_staff_payments
  for select to authenticated using (public.my_role() = 'manager');

-- An issued staff receipt is never edited or deleted from the app: the only change allowed is voiding it once,
-- with a reason. Work done directly in the SQL Editor (as postgres) is not blocked, for supervised corrections.
create or replace function public.guard_transport_staff_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'لا يُحذف إيصال مسجَّل. ألغِه (يبقى محفوظًا بسبب الإلغاء) ثم أصدر إيصالًا جديدًا.';
  end if;
  -- UPDATE: voiding only
  if old.voided_at is not null then
    raise exception 'هذا الإيصال ملغى ولا يُعدَّل.';
  end if;
  if new.voided_at is null or coalesce(btrim(new.void_reason), '') = ''
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'لا يُعدَّل إيصال مسجَّل. ألغِه مع ذكر السبب ثم أصدر إيصالًا جديدًا.';
  end if;
  return new;
end $$;

drop trigger if exists guard_transport_staff_receipt on public.transport_staff_payments;
create trigger guard_transport_staff_receipt before update or delete on public.transport_staff_payments
  for each row execute function public.guard_transport_staff_receipt();

-- the change log (supabase/audit_log.sql), if it is installed
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.transport_staff_members;
    create trigger audit_row after insert or update or delete on public.transport_staff_members
      for each row execute function public.audit_row('staff_id');
    drop trigger if exists audit_row on public.transport_staff_payments;
    create trigger audit_row after insert or update or delete on public.transport_staff_payments
      for each row execute function public.audit_row('receipt_no');
  end if;
end $$;

-- ===== Refunds to staff =====
-- Money given back to a staff member from what they paid for a cycle. The receipt itself is never changed:
-- the refund is its own record (with a voucher number from the same book as the students' refunds when
-- transport_refunds.sql is installed), and the cycle's net is the receipts minus the refunds.
-- A refund is never edited or deleted from the app. Safe to re-run.
create table if not exists public.transport_staff_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no bigint,
  staff_id uuid not null references public.teachers (id) on delete restrict,
  staff_name text not null default '',
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  receipt_no bigint,                                   -- the latest receipt the money was paid with
  paid_before numeric not null default 0,              -- net paid for the cycle before this refund
  amount numeric not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'instapay', 'vodafone', 'other')),
  method_note text not null default '',
  reason text not null check (btrim(reason) <> ''),
  refunded_by text not null default '',
  refunded_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transport_staff_refunds_month_idx on public.transport_staff_refunds (month, staff_id);

do $$
declare
  seq text := case when to_regclass('public.transport_refunds') is not null
                   then pg_get_serial_sequence('public.transport_refunds', 'refund_no') end;
begin
  if seq is null then
    create sequence if not exists public.transport_staff_refunds_no_seq;
    seq := 'public.transport_staff_refunds_no_seq';
  end if;
  execute format('alter table public.transport_staff_refunds alter column refund_no set default nextval(%L::regclass)', seq);
  execute format('grant usage, select on sequence %s to authenticated', seq);
end $$;
create unique index if not exists transport_staff_refunds_no_idx on public.transport_staff_refunds (refund_no);

alter table public.transport_staff_refunds enable row level security;
revoke all on public.transport_staff_refunds from anon;
grant select, insert, update, delete on public.transport_staff_refunds to authenticated;
drop policy if exists transport_staff_refunds_admin on public.transport_staff_refunds;
create policy transport_staff_refunds_admin on public.transport_staff_refunds
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_refunds_manager_read on public.transport_staff_refunds;
create policy transport_staff_refunds_manager_read on public.transport_staff_refunds
  for select to authenticated using (public.my_role() = 'manager');

-- net paid for a staff member's cycle: valid receipts minus refunds
create or replace function public.staff_transport_net(p_staff uuid, p_month text)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce((select sum(amount) from public.transport_staff_payments
                    where staff_id = p_staff and month = p_month and voided_at is null), 0)
       - coalesce((select sum(amount) from public.transport_staff_refunds
                    where staff_id = p_staff and month = p_month), 0)
$$;

-- a refund cannot exceed what is left of the cycle's payments, and is never edited or deleted
create or replace function public.guard_transport_staff_refund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('staff_refund:' || new.staff_id || ':' || new.month));
    if new.amount > public.staff_transport_net(new.staff_id, new.month) then
      raise exception 'المبلغ المسترد أكبر من صافي ما دفعه الموظف عن هذه الدورة.';
    end if;
    return new;
  end if;
  raise exception 'لا يُعدَّل سند استرداد مسجَّل ولا يُحذف.';
end $$;

drop trigger if exists guard_transport_staff_refund on public.transport_staff_refunds;
create trigger guard_transport_staff_refund before insert or update or delete on public.transport_staff_refunds
  for each row execute function public.guard_transport_staff_refund();

-- voiding a receipt must not leave the cycle refunded more than was paid
create or replace function public.guard_transport_staff_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and public.staff_transport_net(new.staff_id, new.month) < 0 then
    raise exception 'استُرد من هذه الدورة مبلغ لا يبقى له غطاء إن أُلغي هذا الإيصال.';
  end if;
  return new;
end $$;

drop trigger if exists guard_transport_staff_void on public.transport_staff_payments;
create trigger guard_transport_staff_void after update on public.transport_staff_payments
  for each row execute function public.guard_transport_staff_void();

do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.transport_staff_refunds;
    create trigger audit_row after insert or update or delete on public.transport_staff_refunds
      for each row execute function public.audit_row('refund_no');
  end if;
end $$;

-- ===== Exemption for staff =====
-- Like the students' exemption: a range of cycles (first and last start month; last empty = until changed)
-- in which the staff member rides without paying. Exempt cycles are never added to any money total. Safe to re-run.
alter table public.transport_staff_members
  add column if not exists exempt_from text check (exempt_from is null or exempt_from ~ '^\d{4}-\d{2}$'),
  add column if not exists exempt_to text check (exempt_to is null or exempt_to ~ '^\d{4}-\d{2}$'),
  add column if not exists exempt_note text not null default '';



-- ================================================================
-- transport_topups.sql
-- ================================================================
-- Top-up receipts: when a student who paid part of a month pays the rest, that payment gets its own receipt
-- (its own number from the same receipt sequence, its own amount, method and date), instead of raising the first receipt.
-- The month's total stays in transport_payments.amount (raised by the top-up), so every screen and total keeps working;
-- the first receipt keeps its number, date and issuer, and prints its own amount.
-- Like the payments: written by the superadmin, read by the manager. A top-up receipt is never edited; it is deleted
-- only together with a copy in the receipt archive (transport_voided).
-- Run this file once in the Supabase SQL Editor, after transport.sql, receipt_archive.sql and receipts_lock.sql.
-- It does not change existing data: earlier top-ups stay merged into their first receipts, as they were issued.

create table if not exists public.transport_topups (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint not null,
  student_id uuid not null references public.students (id) on delete restrict,
  month text not null,                               -- "2026-10"
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  method_note text not null default '',
  paid_before numeric not null default 0,            -- paid for the month before this receipt
  due numeric,                                       -- the month's fee, as on the first receipt
  paid_on date not null default current_date,
  issued_by text not null default '',
  issued_at timestamptz not null default now()
);
create index if not exists transport_topups_month_idx on public.transport_topups (month, student_id);
create unique index if not exists transport_topups_receipt_idx on public.transport_topups (receipt_no);

-- the same numbering as the first receipts: one sequence, numbers never repeat
do $$
declare
  seq text := pg_get_serial_sequence('public.transport_payments', 'receipt_no');
begin
  execute format('alter table public.transport_topups alter column receipt_no set default nextval(%L::regclass)', seq);
end $$;

alter table public.transport_topups enable row level security;
revoke all on public.transport_topups from anon;
grant select, insert, update, delete on public.transport_topups to authenticated;

drop policy if exists transport_topups_admin on public.transport_topups;
create policy transport_topups_admin on public.transport_topups
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

drop policy if exists transport_topups_manager_read on public.transport_topups;
create policy transport_topups_manager_read on public.transport_topups
  for select to authenticated using (public.my_role() = 'manager');

-- An issued top-up receipt is never edited, and is deleted only with its copy in the archive
create or replace function public.guard_transport_topup()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'لا يُعدَّل إيصال مسجَّل. احذفه إلى أرشيف الإيصالات وأصدر إيصالًا جديدًا.';
  end if;
  if not exists (
    select 1 from public.transport_voided v
    where v.student_id = old.student_id and v.month = old.month and v.receipt_no = old.receipt_no
      and v.voided_at > now() - interval '1 hour'
  ) then
    raise exception 'لا يُحذف إيصال مسجَّل إلا بحذفه إلى أرشيف الإيصالات (بسبب مكتوب).';
  end if;
  return old;
end;
$$;

drop trigger if exists transport_topup_guard on public.transport_topups;
create trigger transport_topup_guard
  before update or delete on public.transport_topups
  for each row execute function public.guard_transport_topup();



-- ================================================================
-- transport_unsubscribe.sql
-- ================================================================
-- Stopping a student's transport subscription from a given month.
-- The student stays in the records of earlier months (with what was paid), and owes nothing from that month on.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

alter table public.transport_members
  add column if not exists left_from text check (left_from is null or left_from ~ '^\d{4}-\d{2}$');   -- first month NOT subscribed ("2026-11"); null = subscribed



-- ================================================================
-- visits.sql
-- ================================================================
-- Supervisory visit reports (تقرير زيارة إشرافية صفية).
-- Run this file once in the Supabase SQL Editor, after schema.sql.

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  visit_date date not null default current_date,
  subject text not null default '',
  class_section text not null default '',
  period text not null default '',
  lesson_title text not null default '',
  visit_number int not null default 1,
  strengths jsonb not null default '{}'::jsonb,   -- one text per evaluation domain, keyed "0".."6"
  development text not null default '',
  recommendations text not null default '',
  supervisor_name text not null default '',
  principal_name text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists visits_teacher_idx on public.visits (teacher_id, visit_date desc);

-- Statements added by users to the suggestion lists.
-- field is "d0".."d6" (a domain's strengths), "development" or "recommendations".
create table if not exists public.statements (
  id uuid primary key default gen_random_uuid(),
  field text not null,
  body text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (field, body)
);

alter table public.visits enable row level security;
alter table public.statements enable row level security;

revoke all on public.visits, public.statements from anon;
grant select, insert, update, delete on public.visits to authenticated;
grant select, insert, delete on public.statements to authenticated;

-- Supervisors and the superadmin only; viewers have no access to visit reports.
drop policy if exists visits_staff on public.visits;
create policy visits_staff on public.visits
  for all to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));

drop policy if exists statements_staff on public.statements;
create policy statements_staff on public.statements
  for all to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));



-- ================================================================
-- whatsapp_messages.sql
-- ================================================================
-- رسائل واتساب لأولياء الأمور عبر SendWhats: قوالب تُعدَّل من شاشة «رسائل واتساب» في الموقع، وأرشيف بكل رسالة أُرسلت وحالتها.
-- الإرسال نفسه من دالتي send-whatsapp و send-absence-whatsapp (مفتاح SendWhats فيهما لا في الصفحة)، وهما وحدهما تكتبان في الأرشيف.
-- يرى الشاشة ويرسل منها المدير العام والمسجِّل (نفس من يرسل رسائل الغياب).
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.wa_templates (
  key text primary key,                 -- absence و repeat تستعملهما رسائل الغياب؛ والباقي قوالب حرة
  title text not null,
  body text not null,
  sort int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.wa_messages (
  id bigserial primary key,
  batch_id text not null,               -- دفعة الإرسال في SendWhats
  external_id text not null,            -- معرّف الرسالة داخل الدفعة (الطالب، أو رقم ولي الأمر في رسالة الأسرة)
  kind text not null,                   -- مفتاح القالب: absence, repeat, welcome, facebook, urgent ... أو custom
  title text,
  student_ids text[] not null default '{}',
  names text,                           -- أسماء الطلاب المعنيين
  phone text,
  body text not null,
  status text not null default 'queued', -- queued, sending, sent, delivered, read, failed, cancelled, rejected, nophone
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,
  unique (batch_id, external_id)
);
create index if not exists wa_messages_created on public.wa_messages (created_at desc);

alter table public.wa_templates enable row level security;
alter table public.wa_messages enable row level security;
revoke all on public.wa_templates, public.wa_messages from anon;
grant select, insert, update, delete on public.wa_templates to authenticated;
grant select on public.wa_messages to authenticated;
grant usage on sequence public.wa_messages_id_seq to authenticated;

drop policy if exists wa_templates_rw on public.wa_templates;
create policy wa_templates_rw on public.wa_templates for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar'))
  with check (public.my_role() in ('superadmin', 'registrar') and not coalesce(public.my_read_only(), false));

-- الأرشيف للقراءة فقط من الموقع؛ تكتبه دوال الإرسال بمفتاح الخدمة
drop policy if exists wa_messages_read on public.wa_messages;
create policy wa_messages_read on public.wa_messages for select to authenticated
  using (public.my_role() in ('superadmin', 'registrar'));

-- القوالب الأولى. المتغيرات بين أقواس: {الاسم} {الاسم_الأول} {ولي_الأمر} {الشعبة} {التاريخ} {الأكاديمية}
-- ولرسالة تكرار الغياب أيضًا: {العدد} {من} {إلى}
insert into public.wa_templates (key, title, body, sort) values
  ('absence', 'غياب اليوم', E'السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بغياب الطالب/ـة {الاسم} عن المدرسة اليوم {التاريخ}.\nإدارة المدرسة', 1),
  ('repeat', 'تكرار الغياب', E'السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بتكرر غياب الطالب/ـة {الاسم}، إذ غاب {العدد} أيام خلال الفترة من {من} إلى {إلى}.\nنأمل متابعة انتظامه/ـا في الدوام والتواصل مع إدارة المدرسة عند وجود ظرف.\nإدارة المدرسة', 2),
  ('welcome', 'ترحيب بطالب جديد', E'السلام عليكم ورحمة الله وبركاته،\nأهلًا وسهلًا بكم في {الأكاديمية}.\nيسعدنا انضمام {الاسم} إلينا في {الشعبة}، ونتمنى له/لها عامًا موفقًا.\nإدارة الأكاديمية', 3),
  ('facebook', 'متابعة صفحة فيسبوك', E'السلام عليكم ورحمة الله وبركاته،\nندعوكم لمتابعة صفحة {الأكاديمية} على فيسبوك لمعرفة الأخبار والإعلانات أولًا بأول:\n(ضع رابط الصفحة هنا)\nإدارة الأكاديمية', 4),
  ('urgent', 'تنويه عاجل', E'السلام عليكم ورحمة الله وبركاته،\nتنويه عاجل لأولياء أمور طلاب {الأكاديمية}:\n(اكتب التنويه هنا)\nإدارة الأكاديمية', 5)
on conflict (key) do nothing;



-- ================================================================
-- api.sql
-- ================================================================
-- واجهة التطبيق (API): دوال يستدعيها تطبيق الموبايل (وأي برنامج آخر) بنفس حسابات الموقع وصلاحياته.
-- كل دالة تبدأ بـ api_، تعيد JSON، وتتحقق بنفسها من صلاحية صاحب الحساب. رسائل الخطأ بالعربية.
-- منطق الحساب هنا هو منطق الموقع نفسه (index.html)، منقولًا كما هو، فتتطابق الأرقام في الموقع والتطبيق.
-- التوثيق والأمثلة: docs/API.md
--
-- يحتاج إلى ملفات سابقة: students.sql, student_registration.sql, reserve_and_exempt.sql, transport*.sql, receipts_due.sql,
-- attendance.sql, attendance_links.sql, timetable.sql, timetable_plan.sql, substitutes.sql, parent_links.sql.
-- شغّل هذا الملف في محرر SQL في Supabase؛ ويمكن تشغيله مرة أخرى بعد أي تحديث له. لا يغيّر أي بيانات.

-- ===================================================================================================
-- مساعدات
-- ===================================================================================================

-- ترتيب الأسماء العربية كما يرتبها الموقع (localeCompare 'ar')
create collation if not exists public.api_ar (provider = icu, locale = 'ar');

-- يوقف الدالة إن لم يكن صاحب الحساب من الأدوار المذكورة
create or replace function public.api_need(variadic p_roles text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  if coalesce(public.my_role(), '') <> all (p_roles) then raise exception 'ليس لديك صلاحية لهذه العملية' using errcode = '42501'; end if;
end $$;

-- اليوم في مصر
create or replace function public.api_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- النص العربي بصيغة واحدة للبحث والمقارنة (مثل norm() في الموقع)
create or replace function public.api_norm(p text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(translate(regexp_replace(coalesce(p, ''), '[ً-ْـ*؟?:]', '', 'g'), 'أإآةى', 'اااهي'), '\s+', ' ', 'g')))
$$;

-- «الشهر» في المواصلات دورة: تُعرف بشهر بدايتها، ومواعيدها ورسومها من transport_cycle() (supabase/transport_cycles.sql)
drop function if exists public.api_fees();

-- آخر موعد لسداد اشتراك الدورة
create or replace function public.api_deadline(p_month text) returns date
language sql stable security definer set search_path = public as $$ select (public.transport_cycle(p_month) ->> 'due')::date $$;

-- ===================================================================================================
-- المواصلات: المطلوب من كل مشترك عن شهر (مثل payRows / dueRows في الموقع)
-- ===================================================================================================
-- المطالَب: من بدأ اشتراكه (صدر له إيصال عن الشهر أو قبله) ولم يُوقَف، أو المعفى المشترك، أو من له دفعة عن الشهر.
-- المطلوب: المحفوظ في إيصال الشهر إن صدر، وإلا المحدد له يدويًا، وإلا رسوم الأسرة: الأول من الإخوة المشتركين بمبلغ، ومن بعده بمبلغ أقل.
-- الإخوة: يجمعهم رقم هوية ولي الأمر أو الهاتف (آخر 10 أرقام) أو اسم الأب والجد والعائلة؛ والأول من بدأ اشتراكه أولًا (شهر أول دفعة) ثم الأكبر سنًّا ثم بالاسم.
-- الحالة: ok (لا متبقي)، grace (ضمن المهلة)، extended (مهلة إضافية)، late (متأخر)، suspended (موقوف عن الركوب).
create or replace function public.api_transport_dues(p_month text)
returns table (student_id uuid, group_id uuid, share numeric, paid numeric, left_amount numeric, exempt boolean, status text, state text, family_rank int, family_size int)
language plpgsql stable security definer set search_path = public as $$
declare
  fees jsonb := public.transport_cycle(p_month);   -- رسوم الدورة: الأول والإخوة
  today date := public.api_today();
begin
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'الشهر بصيغة YYYY-MM'; end if;
  return query
  with first_paid as (
    select p.student_id as sid, min(p.month) as m from transport_payments p where p.amount > 0 group by p.student_id
  ), pay as (
    select p.student_id as sid, p.amount, p.due from transport_payments p where p.month = p_month
  ), mem as (
    select m.student_id as sid, m.group_id as gid, m.share as mshare, m.left_from, m.exempt_from, m.exempt_to, m.grace_until, m.suspended_month,
           x.full_name, x.phone, x.details, to_jsonb(x) ->> 'birth_date' as birth, fp.m as first_m, py.amount as pamount, py.due as pdue,
           (m.exempt_from is not null and p_month >= m.exempt_from and (m.exempt_to is null or m.exempt_to = '' or p_month <= m.exempt_to)) as ex,
           (m.left_from is null or p_month < m.left_from) as subscribed
    from transport_members m
    join students x on x.id = m.student_id
    left join first_paid fp on fp.sid = m.student_id
    left join pay py on py.sid = m.student_id
  ), owing as (
    select * from mem
    where (ex and subscribed) or (first_m is not null and first_m <= p_month and subscribed) or coalesce(pamount, 0) > 0
  ), keys as (   -- مفاتيح الأخوّة
    select o.sid, 'g:' || btrim(o.details ->> 'guardian_id') as k from owing o where length(btrim(coalesce(o.details ->> 'guardian_id', ''))) >= 5
    union
    select o.sid, 'p:' || right(regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g'), 10) from owing o
      where length(regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g')) >= 8
    union
    select o.sid, 'n:' || f.fam from owing o
      cross join lateral (select array_to_string((regexp_split_to_array(public.api_norm(o.full_name), ' '))[2:], ' ') as fam) f
      where array_length(regexp_split_to_array(f.fam, ' '), 1) >= 3
  ), edges as (
    select a.sid as a, b.sid as b from keys a join keys b on a.k = b.k
  ), reach as (   -- كل من يصل إليه الطالب عبر مفاتيح مشتركة
    with recursive r(a, b) as (
      select o.sid, o.sid from owing o
      union
      select r.a, e.b from r join edges e on e.a = r.b
    ) select * from r
  ), fam as (
    select r.a as sid, min(r.b::text) as root from reach r group by r.a
  ), ranked as (
    select o.sid, f.root,
      row_number() over (partition by f.root order by coalesce(o.first_m, '9999'), coalesce(o.birth, '9999'), o.full_name collate public.api_ar) as rnk,
      count(*) over (partition by f.root) as size
    from owing o join fam f on f.sid = o.sid
  ), calc as (
    select o.*, g.id as group_ok, rk.rnk, rk.size,
      case when coalesce(o.pamount, 0) > 0 and o.pdue is not null then o.pdue
           when o.mshare is not null then o.mshare
           when rk.rnk > 1 then (fees ->> 'next')::numeric
           else (fees ->> 'first')::numeric end as sh
    from owing o join transport_groups g on g.id = o.gid join ranked rk on rk.sid = o.sid
  )
  select c.sid, c.gid, c.sh, coalesce(c.pamount, 0),
    case when c.ex then 0 else greatest(0, c.sh - coalesce(c.pamount, 0)) end,
    c.ex,
    case when c.ex then 'exempt' when c.sh > 0 and coalesce(c.pamount, 0) >= c.sh then 'paid' when coalesce(c.pamount, 0) > 0 then 'part' when c.sh > 0 then 'unpaid' else 'none' end,
    case when c.ex or greatest(0, c.sh - coalesce(c.pamount, 0)) <= 0 then 'ok'
         when c.suspended_month = p_month then 'suspended'
         when today <= public.api_deadline(p_month) then 'grace'
         when c.grace_until is not null and c.grace_until >= today then 'extended'
         else 'late' end,
    c.rnk::int, c.size::int
  from calc c;
end $$;

-- الإيصالات بين تاريخين (بتاريخ السداد): الأول بمبلغه الأول (قبل الإيصالات المكمِّلة)، والمكمِّل بمبلغه (مثل receiptsBetween في الموقع)
create or replace function public.api_receipt_rows(p_from date, p_to date)
returns table (receipt_no bigint, kind text, student_id uuid, month text, amount numeric, method text, ref text, issued_by text, paid_on date, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  with tops as (select * from transport_topups),
  first_top as (select distinct on (t.student_id, t.month) t.student_id, t.month, t.paid_before from tops t order by t.student_id, t.month, t.receipt_no)
  select p.receipt_no, 'main', p.student_id, p.month, coalesce(ft.paid_before, p.amount),
         case when p.method in ('cash', 'instapay', 'vodafone', 'other') then p.method else 'cash' end, coalesce(p.method_note, ''), coalesce(p.issued_by, ''), p.paid_on, p.issued_at
  from transport_payments p left join first_top ft on ft.student_id = p.student_id and ft.month = p.month
  where p.amount > 0 and p.paid_on between p_from and p_to
  union all
  select t.receipt_no, 'topup', t.student_id, t.month, t.amount,
         case when t.method in ('cash', 'instapay', 'vodafone', 'other') then t.method else 'cash' end, coalesce(t.method_note, ''), coalesce(t.issued_by, ''), t.paid_on, t.issued_at
  from tops t where t.paid_on between p_from and p_to
$$;

-- سجل الدفعات لفترة: الإيصالات، والمجاميع حسب وسيلة الدفع وحسب اليوم
create or replace function public.api_ledger(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('superadmin', 'manager');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'اختر فترة صحيحة'; end if;
  return (
    with r as (
      select r.*, x.full_name, x.class_name, g.assembly_point
      from public.api_receipt_rows(p_from, p_to) r
      left join students x on x.id = r.student_id
      left join transport_members m on m.student_id = r.student_id
      left join transport_groups g on g.id = m.group_id
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'total', coalesce((select sum(amount) from r), 0),
      'count', (select count(*) from r),
      'by_method', coalesce((select jsonb_object_agg(method, s) from (select method, sum(amount) as s from r group by method) q), '{}'::jsonb),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', paid_on, 'count', n, 'total', s, 'cash', c) order by paid_on)
                 from (select paid_on, count(*) as n, sum(amount) as s, coalesce(sum(amount) filter (where method = 'cash'), 0) as c from r group by paid_on) q), '[]'::jsonb),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('receipt_no', receipt_no, 'kind', kind, 'student_id', student_id, 'student', coalesce(full_name, '(طالب محذوف)'),
                    'class_name', coalesce(class_name, ''), 'bus', coalesce(assembly_point, ''), 'month', month, 'amount', amount, 'method', method, 'ref', ref,
                    'issued_by', issued_by, 'paid_on', paid_on, 'issued_at', issued_at) order by paid_on, receipt_no) from r), '[]'::jsonb))
  );
end $$;

-- المتأخرون في دفع المواصلات عن شهر (وكل من عليه متبقٍّ، بحالته)
create or replace function public.api_late_payers(p_month text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mon text := coalesce(nullif(p_month, ''), public.transport_current_cycle(public.api_today()));
begin
  perform public.api_need('superadmin', 'manager');
  return (
    with d as (
      select d.*, x.full_name, x.class_name, x.guardian_name, x.phone, x.whatsapp, g.assembly_point, m.grace_until
      from public.api_transport_dues(mon) d
      join students x on x.id = d.student_id join transport_groups g on g.id = d.group_id join transport_members m on m.student_id = d.student_id
      where d.left_amount > 0
    )
    select jsonb_build_object(
      'month', mon, 'cycle', public.transport_cycle(mon), 'deadline', public.api_deadline(mon),
      'days_late', greatest(0, public.api_today() - public.api_deadline(mon)),
      'counts', jsonb_build_object('late', (select count(*) from d where state = 'late'), 'extended', (select count(*) from d where state = 'extended'),
                                   'suspended', (select count(*) from d where state = 'suspended'), 'grace', (select count(*) from d where state = 'grace')),
      'owed', coalesce((select sum(left_amount) from d where state <> 'grace'), 0),
      'students', coalesce((select jsonb_agg(jsonb_build_object('student_id', student_id, 'name', full_name, 'class_name', class_name, 'bus', assembly_point,
                    'guardian', guardian_name, 'phone', phone, 'whatsapp', whatsapp, 'share', share, 'paid', paid, 'left', left_amount, 'state', state, 'grace_until', grace_until)
                    order by case state when 'late' then 0 when 'extended' then 1 when 'suspended' then 2 else 3 end, assembly_point, full_name) from d), '[]'::jsonb))
  );
end $$;

-- الغياب في يوم: لكل شعبة عدد طلابها، وهل سُجّل غيابها ومن سجّله، والغائبون
create or replace function public.api_attendance_day(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, public.api_today());
begin
  perform public.api_need('superadmin', 'manager', 'supervisor');
  return (
    with roll as (select x.class_name, count(*) as n from students x where x.status in ('final', 'reserve') and x.class_name <> '' group by x.class_name),
    att as (select a.*, x.full_name from attendance a left join students x on x.id = a.student_id where a.day = d),
    cls as (select class_name from roll union select class_name from att where class_name <> '')
    select jsonb_build_object('day', d,
      'students', (select count(*) from att),
      'absent', (select count(*) from att where status in ('absent', 'excused')),
      'classes', coalesce((select jsonb_agg(jsonb_build_object(
          'class_name', c.class_name, 'students', coalesce(r.n, 0),
          'recorded', exists (select 1 from att a where a.class_name = c.class_name),
          'recorded_by', (select max(a.recorded_by) from att a where a.class_name = c.class_name),
          'absent', coalesce((select jsonb_agg(jsonb_build_object('student_id', a.student_id, 'name', a.full_name, 'note', a.note) order by a.full_name)
                              from att a where a.class_name = c.class_name and a.status in ('absent', 'excused')), '[]'::jsonb)) order by c.class_name)
        from cls c left join roll r on r.class_name = c.class_name), '[]'::jsonb))
  );
end $$;

-- لوحة المؤشرات (مثل الرئيسية في الموقع). المشرف يرى الغياب فقط
create or replace function public.api_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d date := public.api_today();
  mon text := public.transport_current_cycle(d);
  wd text := (array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'])[extract(dow from d)::int + 1];
  days jsonb;
  att jsonb; res jsonb;
begin
  perform public.api_need('superadmin', 'manager', 'supervisor');
  select c.days into days from timetable_config c where c.id = 1;
  with roll as (select x.class_name from students x where x.status in ('final', 'reserve') and x.class_name <> '' group by x.class_name),
  a as (select * from attendance where day = d)
  select jsonb_build_object(
    'school_day', days is null or jsonb_array_length(days) = 0 or days ? wd, 'weekday', wd,
    'taken', (select count(*) from a), 'absent', (select count(*) from a where status in ('absent', 'excused')),
    'classes_missing', (select count(*) from roll r where not exists (select 1 from a where a.class_name = r.class_name)))
  into att;
  res := jsonb_build_object('day', d, 'attendance', att);
  if public.my_role() = 'supervisor' then return res; end if;

  return res || (
    with rec as (select * from public.api_receipt_rows((public.transport_cycle(mon) ->> 'from')::date, d)),
    due as (select * from public.api_transport_dues(mon)),
    caps as (
      select e ->> 'name' as name, case when (e ->> 'capacity') ~ '^[0-9]+$' and (e ->> 'capacity')::int > 0 then (e ->> 'capacity')::int end as cap
      from settings s, jsonb_array_elements(case when jsonb_typeof(s.classes) = 'object' then coalesce(s.classes -> 'list', '[]'::jsonb) else '[]'::jsonb end) e
      where s.id = 1 and jsonb_typeof(e) = 'object'
    ), filled as (
      select c.name, c.cap, (select count(*) from students x where x.status in ('final', 'reserve') and x.class_name = c.name) as n from caps c where c.cap is not null
    )
    select jsonb_build_object(
      'cycle', public.transport_cycle(mon),
      'collected_today', jsonb_build_object('total', coalesce((select sum(amount) from rec where paid_on = d), 0), 'cash', coalesce((select sum(amount) from rec where paid_on = d and method = 'cash'), 0),
                                            'count', (select count(*) from rec where paid_on = d)),
      'collected_month', jsonb_build_object('total', coalesce((select sum(amount) from rec), 0), 'cash', coalesce((select sum(amount) from rec where method = 'cash'), 0), 'count', (select count(*) from rec)),
      'late', jsonb_build_object('count', (select count(*) from due where state = 'late'), 'owed', coalesce((select sum(left_amount) from due where state = 'late'), 0),
                                 'suspended', (select count(*) from due where state = 'suspended'), 'deadline', public.api_deadline(mon)),
      'new_students', jsonb_build_object(
          'month', (select count(*) from students x where to_char(x.created_at at time zone 'UTC', 'YYYY-MM') = mon),
          'week', (select count(*) from students x where (x.created_at at time zone 'UTC')::date >= ((now() at time zone 'UTC')::date - 6)),
          'pending', (select count(*) from students x where x.status not in ('final', 'reserve', 'dropped'))),
      'classes', jsonb_build_object('full', coalesce((select jsonb_agg(name) from filled where n = cap), '[]'::jsonb),
                                    'over', coalesce((select jsonb_agg(name) from filled where n > cap), '[]'::jsonb)))
  );
end $$;

-- بحث في الطلاب: بالاسم أو اسم ولي الأمر، أو بأرقام الهوية أو الهاتف؛ وتصفية بالشعبة والحالة (final / reserve / pending / dropped)
create or replace function public.api_students(p_q text default '', p_class text default '', p_status text default '', p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := public.api_norm(p_q);
  dg text := regexp_replace(translate(coalesce(p_q, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
begin
  perform public.api_need('superadmin', 'manager');
  return (
    with f as (
      select x.* from students x
      where (coalesce(p_class, '') = '' or x.class_name = p_class)
        and (coalesce(p_status, '') = '' or (case when x.status in ('final', 'reserve', 'dropped') then x.status else 'pending' end) = p_status)
        and (q = '' or position(q in public.api_norm(x.full_name || ' ' || coalesce(x.guardian_name, ''))) > 0
             or (length(dg) >= 3 and (position(dg in coalesce(x.national_id, '')) > 0 or position(dg in coalesce(x.phone, '')) > 0 or position(dg in coalesce(x.whatsapp, '')) > 0)))
    )
    select jsonb_build_object('total', (select count(*) from f),
      'students', coalesce((select jsonb_agg(row_to_json(s)) from (
        select f.id, f.full_name, f.class_name, case when f.status in ('final', 'reserve', 'dropped') then f.status else 'pending' end as status,
               f.guardian_name, f.phone, f.whatsapp, g.assembly_point as bus
        from f left join transport_members m on m.student_id = f.id left join transport_groups g on g.id = m.group_id
        order by f.full_name collate public.api_ar, f.id limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) s), '[]'::jsonb))
  );
end $$;

-- ملف الطالب: بياناته، غيابه هذا العام الدراسي، اشتراكه في المواصلات وإيصالاته ومطلوب الشهر الحالي
create or replace function public.api_student_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  x students;
  y0 date := make_date(extract(year from public.api_today())::int - case when extract(month from public.api_today()) < 9 then 1 else 0 end, 9, 1);
  mon text := public.transport_current_cycle(public.api_today());
begin
  perform public.api_need('superadmin', 'manager');
  select * into x from students where id = p_id;
  if x.id is null then raise exception 'الطالب غير موجود'; end if;
  return jsonb_build_object(
    'student', to_jsonb(x) - 'form_answers',
    'attendance', jsonb_build_object('since', y0,
        'recorded_days', (select count(*) from attendance a where a.student_id = p_id and a.day >= y0),
        'absences', coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'note', a.note) order by a.day desc) from attendance a
                              where a.student_id = p_id and a.day >= y0 and a.status in ('absent', 'excused')), '[]'::jsonb)),
    'transport', (select jsonb_build_object('bus', g.assembly_point, 'pickup', m.pickup, 'left_from', m.left_from, 'exempt_from', m.exempt_from, 'exempt_to', m.exempt_to,
                     'suspended_month', m.suspended_month, 'grace_until', m.grace_until,
                     'this_month', (select to_jsonb(d) - 'student_id' - 'group_id' from public.api_transport_dues(mon) d where d.student_id = p_id))
                  from transport_members m join transport_groups g on g.id = m.group_id where m.student_id = p_id),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r) - 'student_id' order by r.paid_on desc, r.receipt_no desc)
                          from public.api_receipt_rows('2000-01-01', '2999-12-31') r where r.student_id = p_id), '[]'::jsonb)
  );
end $$;

-- ===================================================================================================
-- جدول الحصص والاحتياط
-- ===================================================================================================

-- أيام الدراسة كما في إعدادات الجدول (الحصة day = ترتيب اليوم فيها)
create or replace function public.api_tt_days() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(c.days) = 'array' and jsonb_array_length(c.days) > 0 then c.days end from timetable_config c where c.id = 1),
                  '["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]'::jsonb)
$$;

-- ترتيب يوم التاريخ في أيام الدراسة، أو -1 إن لم يكن يوم دراسة
create or replace function public.api_tt_day_index(p_day date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (e.i - 1)::int from jsonb_array_elements_text(public.api_tt_days()) with ordinality e(name, i)
                   where e.name = (array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'])[extract(dow from p_day)::int + 1]), -1)
$$;

-- موعد الحصة لشعبة: من مرحلتها في «مواعيد الدوام» (الشعبة التي لم تُضف إلى مرحلة تتبع آخر مرحلة). { from, to } أو null
create or replace function public.api_period_time(p_class text, p_period int) returns jsonb
language sql stable security definer set search_path = public as $$
  with st as (
    select s.value as stage, s.i from timetable_config c, jsonb_array_elements(coalesce(c.bells -> 'stages', '[]'::jsonb)) with ordinality s(value, i) where c.id = 1
  ), pick as (
    select stage from st where coalesce(stage -> 'classes', '[]'::jsonb) ? p_class
    union all
    select stage from (select stage from st order by i desc limit 1) l
    limit 1
  ), periods as (
    select r.value, row_number() over (order by r.i) as n
    from pick, jsonb_array_elements(coalesce(pick.stage -> 'rows', '[]'::jsonb)) with ordinality r(value, i) where r.value ->> 'k' = 'p'
  )
  select jsonb_build_object('from', value ->> 'f', 'to', value ->> 't') from periods where n = p_period
$$;

create or replace function public.api_fix_subject(p text) returns text
language sql immutable as $$ select case when btrim(coalesce(p, '')) = 'قرأن' then 'قرآن' else btrim(coalesce(p, '')) end $$;

-- جدول معلم أو شعبة. المعلم صاحب الحساب يرى جدوله بلا وسائط (ويمكنه عرض جدول شعبة)
create or replace function public.api_timetable(p_teacher uuid default null, p_class text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid; t uuid := p_teacher;
begin
  perform public.api_need('superadmin', 'manager', 'supervisor', 'teacher');
  if public.my_role() = 'teacher' then
    select teacher_id into me from profiles where id = auth.uid();
    if t is not null and t is distinct from me then raise exception 'ليس لديك صلاحية لجدول معلم آخر'; end if;
    if coalesce(p_class, '') = '' then t := me; end if;
  end if;
  if t is null and coalesce(p_class, '') = '' then raise exception 'حدّد المعلم أو الشعبة'; end if;
  return jsonb_build_object('days', public.api_tt_days(),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'day_name', public.api_tt_days() ->> s.day, 'period', s.period,
        'time', public.api_period_time(s.class_name, s.period), 'class_name', s.class_name, 'subject', public.api_fix_subject(s.subject),
        'teacher_id', s.teacher_id, 'teacher', te.name) order by s.day, s.period, s.class_name)
      from timetable_sessions s left join teachers te on te.id = s.teacher_id
      where s.status <> 'removed' and (t is null or s.teacher_id = t) and (coalesce(p_class, '') = '' or s.class_name = p_class)), '[]'::jsonb));
end $$;

-- حصص الاحتياط المطلوبة من المعلم صاحب الحساب (من اليوم ولعدد من الأيام)
create or replace function public.api_my_substitutes(p_from date default null, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid; d0 date := coalesce(p_from, public.api_today());
begin
  perform public.api_need('teacher', 'supervisor', 'superadmin');
  select teacher_id into me from profiles where id = auth.uid();
  if me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'period', s.period, 'time', public.api_period_time(s.class_name, s.period),
      'class_name', s.class_name, 'subject', s.subject, 'absent_teacher', te.name) order by s.day, s.period)
    from substitutions s left join teachers te on te.id = s.absent_teacher_id
    where s.sub_teacher_id = me and s.day between d0 and d0 + greatest(coalesce(p_days, 7), 1) - 1), '[]'::jsonb);
end $$;

-- البدلاء المحتملون لحصة، مرتبين كما في الموقع (subCandidates): متاح في الحصة وليس غائبًا ولا يغطي غيرها؛
-- ثم من في المدرسة ذلك اليوم، ثم غير محفّظي القرآن، ثم الأقل احتياطًا اليوم ثم في الشهر، ثم من يدرّس الشعبة، ثم المادة نفسها، ثم الأخف يومًا
create or replace function public.api_sub_candidates(p_day date, p_class text, p_period int)
returns table (teacher_id uuid, name text, on_site boolean, quran boolean, today_count int, month_count int, teaches_class boolean, same_subject boolean, load int)
language sql stable security definer set search_path = public as $$
  with di as (select public.api_tt_day_index(p_day) as i),
  live as (select * from timetable_sessions where status <> 'removed'),
  lesson as (select l.* from live l, di where l.day = di.i and l.period = p_period and l.class_name = p_class limit 1),
  ab as (select a.teacher_id, a.periods from teacher_absences a where a.day = p_day),
  subs_day as (select * from substitutions where day = p_day and sub_teacher_id is not null),
  subs_month as (select sub_teacher_id, count(*) as n from substitutions where sub_teacher_id is not null and to_char(day, 'YYYY-MM') = to_char(p_day, 'YYYY-MM') group by sub_teacher_id)
  select t.id, t.name,
    exists (select 1 from live x, di where x.teacher_id = t.id and x.day = di.i),
    (to_jsonb(t) ->> 'category' = 'محفظون') or not exists (select 1 from live x where x.teacher_id = t.id and public.api_norm(public.api_fix_subject(x.subject)) <> public.api_norm('قرآن')),
    (select count(*) from subs_day s where s.sub_teacher_id = t.id)::int,
    coalesce((select n from subs_month m where m.sub_teacher_id = t.id), 0)::int,
    exists (select 1 from live x, lesson l where x.teacher_id = t.id and x.class_name = l.class_name),
    exists (select 1 from live x, lesson l where x.teacher_id = t.id and public.api_norm(public.api_fix_subject(x.subject)) = public.api_norm(public.api_fix_subject(l.subject))),
    (select count(*) from live x, di where x.teacher_id = t.id and x.day = di.i)::int
  from teachers t, lesson l
  where t.id is distinct from l.teacher_id
    and exists (select 1 from live x where x.teacher_id = t.id)
    and not exists (select 1 from ab where ab.teacher_id = t.id and (ab.periods is null or cardinality(ab.periods) = 0 or p_period = any (ab.periods)))
    and not exists (select 1 from live x, di where x.teacher_id = t.id and x.day = di.i and x.period = p_period)
    and not exists (select 1 from subs_day s where s.sub_teacher_id = t.id and s.period = p_period and s.class_name <> p_class)
  order by 3 desc, 4 asc, 5 asc, 6 asc, 7 desc, 8 desc, 9 asc, t.name collate public.api_ar
$$;

-- الاحتياط في يوم: المعلمون الغائبون، وحصصهم، ومن عُيّن لكل حصة، وأفضل البدلاء
create or replace function public.api_subs_day(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, public.api_today()); di int;
begin
  perform public.api_need('superadmin', 'manager', 'supervisor');
  di := public.api_tt_day_index(d);
  if di < 0 then return jsonb_build_object('day', d, 'school_day', false, 'absences', '[]'::jsonb, 'lessons', '[]'::jsonb); end if;
  return jsonb_build_object('day', d, 'school_day', true,
    'absences', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'teacher_id', a.teacher_id, 'teacher', te.name, 'periods', a.periods, 'reason', a.reason) order by te.name)
                          from teacher_absences a left join teachers te on te.id = a.teacher_id where a.day = d), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('period', s.period, 'time', public.api_period_time(s.class_name, s.period), 'class_name', s.class_name,
        'subject', public.api_fix_subject(s.subject), 'absent_teacher_id', s.teacher_id, 'absent_teacher', te.name,
        'substitute_id', r.sub_teacher_id, 'substitute', st.name,
        'candidates', coalesce((select jsonb_agg(to_jsonb(c)) from (select * from public.api_sub_candidates(d, s.class_name, s.period) limit 5) c), '[]'::jsonb))
        order by s.period, s.class_name)
      from timetable_sessions s
      join teacher_absences a on a.teacher_id = s.teacher_id and a.day = d
      left join teachers te on te.id = s.teacher_id
      left join substitutions r on r.day = d and r.class_name = s.class_name and r.period = s.period
      left join teachers st on st.id = r.sub_teacher_id
      where s.status <> 'removed' and s.day = di and (a.periods is null or cardinality(a.periods) = 0 or s.period = any (a.periods))), '[]'::jsonb));
end $$;

-- تسجيل غياب معلم ليوم (كله: p_periods فارغ، أو حصص منه)، أو إلغاؤه مع ما وُزّع عنه من احتياط
create or replace function public.api_teacher_absence(p_day date, p_teacher uuid, p_periods smallint[] default null, p_reason text default '', p_remove boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  perform public.api_need('superadmin', 'supervisor');
  if p_day is null or p_teacher is null then raise exception 'حدّد اليوم والمعلم'; end if;
  if p_remove then
    delete from substitutions where day = p_day and absent_teacher_id = p_teacher;
    delete from teacher_absences where day = p_day and teacher_id = p_teacher;
    return jsonb_build_object('removed', true);
  end if;
  if not exists (select 1 from teachers where id = p_teacher) then raise exception 'المعلم غير موجود'; end if;
  select coalesce(nullif(full_name, ''), email) into who from profiles where id = auth.uid();
  insert into teacher_absences (day, teacher_id, periods, reason, created_by)
  values (p_day, p_teacher, case when cardinality(p_periods) > 0 then p_periods end, coalesce(p_reason, ''), coalesce(who, ''))
  on conflict (day, teacher_id) do update set periods = excluded.periods, reason = excluded.reason;
  return public.api_subs_day(p_day);
end $$;

-- تعيين معلم احتياط لحصة (أو إلغاء التعيين بـ p_teacher فارغ). يُرفض من ليس متاحًا في تلك الحصة
create or replace function public.api_assign_substitute(p_day date, p_class text, p_period int, p_teacher uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s timetable_sessions; who text;
begin
  perform public.api_need('superadmin', 'supervisor');
  select x.* into s from timetable_sessions x
  join teacher_absences a on a.teacher_id = x.teacher_id and a.day = p_day
  where x.status <> 'removed' and x.day = public.api_tt_day_index(p_day) and x.class_name = p_class and x.period = p_period
    and (a.periods is null or cardinality(a.periods) = 0 or x.period = any (a.periods))
  limit 1;
  if s.id is null then raise exception 'لا توجد حصة لمعلم غائب في هذه الشعبة والحصة'; end if;
  if p_teacher is not null and not exists (select 1 from public.api_sub_candidates(p_day, p_class, p_period) c where c.teacher_id = p_teacher) then
    raise exception 'هذا المعلم غير متاح في هذه الحصة (عنده حصة، أو غائب، أو يغطي حصة أخرى)';
  end if;
  select coalesce(nullif(full_name, ''), email) into who from profiles where id = auth.uid();
  insert into substitutions (day, period, class_name, subject, absent_teacher_id, sub_teacher_id, created_by)
  values (p_day, p_period, p_class, public.api_fix_subject(s.subject), s.teacher_id, p_teacher, coalesce(who, ''))
  on conflict (day, class_name, period) do update set sub_teacher_id = excluded.sub_teacher_id, absent_teacher_id = excluded.absent_teacher_id, subject = excluded.subject;
  return public.api_subs_day(p_day);
end $$;

-- ===================================================================================================
-- تسجيل الغياب من حساب المعلم: بقيود رابط الغياب نفسها (ليوم اليوم فقط، وأسماء الطلاب فقط)
-- ===================================================================================================

create or replace function public.api_att_who() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select te.name from profiles p join teachers te on te.id = p.teacher_id where p.id = auth.uid()),
                  (select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid()), '')
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

-- النسخة المعتمدة من api_att_roll في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_roll' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

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

-- ===================================================================================================
-- أولياء الأمور (بالرابط السري، بلا حساب)
-- ===================================================================================================

create or replace function public.api_parent_view(p_token text) returns jsonb
language sql security definer set search_path = public as $$ select public.parent_view(p_token) $$;

-- أجهزة أولياء الأمور: تمهيدًا لإشعارات التطبيق (إشعار الغياب مثلًا). الجهاز يُربط برابط ولي الأمر
create table if not exists public.parent_devices (
  device_token text primary key,
  parent_token text not null references public.parent_links (token) on delete cascade,
  platform text not null default '' check (platform in ('', 'android', 'ios')),
  updated_at timestamptz not null default now()
);
alter table public.parent_devices enable row level security;
revoke all on public.parent_devices from anon, authenticated;
grant select on public.parent_devices to authenticated;
drop policy if exists parent_devices_admin on public.parent_devices;
create policy parent_devices_admin on public.parent_devices for select to authenticated using (public.my_role() = 'superadmin');

create or replace function public.api_register_device(p_token text, p_device text, p_platform text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from parent_links where token = p_token and active) then return jsonb_build_object('error', 'الرابط غير صالح أو أُلغي'); end if;
  if length(coalesce(p_device, '')) < 20 then return jsonb_build_object('error', 'معرّف الجهاز غير صالح'); end if;
  insert into parent_devices (device_token, parent_token, platform, updated_at)
  values (p_device, p_token, case when p_platform in ('android', 'ios') then p_platform else '' end, now())
  on conflict (device_token) do update set parent_token = excluded.parent_token, platform = excluded.platform, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_unregister_device(p_device text) returns jsonb
language sql security definer set search_path = public as $$
  delete from parent_devices where device_token = p_device returning jsonb_build_object('ok', true)
$$;

-- ===================================================================================================
-- الصلاحيات: الدوال المساعدة لا تُستدعى مباشرة (تقرأ بلا قيود)، والواجهة لأصحاب الحسابات، ودوال ولي الأمر لمن يملك الرابط
-- ===================================================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'api_need(text[])', 'api_deadline(text)', 'api_transport_dues(text)', 'api_receipt_rows(date, date)',
    'api_tt_days()', 'api_tt_day_index(date)', 'api_period_time(text, integer)', 'api_sub_candidates(date, text, integer)', 'api_att_who()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'api_ledger(date, date)', 'api_late_payers(text)', 'api_attendance_day(date)', 'api_dashboard()', 'api_students(text, text, text, integer, integer)',
    'api_student_file(uuid)', 'api_timetable(uuid, text)', 'api_my_substitutes(date, integer)', 'api_subs_day(date)',
    'api_teacher_absence(date, uuid, smallint[], text, boolean)', 'api_assign_substitute(date, text, integer, uuid)',
    'api_att_classes()', 'api_att_roll(text)', 'api_att_submit(text, uuid[])'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['api_parent_view(text)', 'api_register_device(text, text, text)', 'api_unregister_device(text)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;



-- ================================================================
-- attendance.sql
-- ================================================================
-- Daily attendance: one row per student per school day, written when a class's attendance is taken.
-- Read and written by the superadmin and registrars (the people who can see student records).
-- Run this file once in the Supabase SQL Editor, after students.sql and registrar.sql. It does not change existing data.

create table if not exists public.attendance (
  student_id uuid not null references public.students (id) on delete cascade,
  day date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  note text not null default '',
  class_name text not null default '',          -- the class the student was in that day (reports by class keep working after a move)
  recorded_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, day)
);
create index if not exists attendance_day_idx on public.attendance (day);
create index if not exists attendance_class_day_idx on public.attendance (class_name, day);

alter table public.attendance enable row level security;
revoke all on public.attendance from anon;
grant select, insert, update, delete on public.attendance to authenticated;

drop policy if exists attendance_staff on public.attendance;
create policy attendance_staff on public.attendance
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar'))
  with check (public.my_role() in ('superadmin', 'registrar'));



-- ================================================================
-- attendance_supervisor.sql
-- ================================================================
-- Supervisors see the attendance screen and export its reports (detailed absence list with contacts).
-- Read-only: they can read student records and attendance, and change nothing (recording stays with the superadmin and registrars).
-- The manager already reads both (manager.sql).
-- Run this file once in the Supabase SQL Editor, after students.sql and attendance.sql. It does not change existing data.

drop policy if exists students_supervisor_read on public.students;
create policy students_supervisor_read on public.students
  for select to authenticated using (public.my_role() = 'supervisor');

drop policy if exists attendance_supervisor_read on public.attendance;
create policy attendance_supervisor_read on public.attendance
  for select to authenticated using (public.my_role() = 'supervisor');



-- ================================================================
-- committees.sql
-- ================================================================
-- School committees: a committee has members from the staff (public.teachers) and students (public.students).
-- Edited by the superadmin; read by the manager and the supervisor. Deleting a committee removes its member rows only.
-- Run this file once in the Supabase SQL Editor, after manager.sql and attendance_supervisor.sql. It does not change existing data.

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists committees_name_idx on public.committees (lower(name));

create table if not exists public.committee_members (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees (id) on delete cascade,
  kind text not null check (kind in ('staff', 'student')),
  staff_id uuid references public.teachers (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check ((kind = 'staff' and staff_id is not null and student_id is null) or (kind = 'student' and student_id is not null and staff_id is null)),
  unique (committee_id, staff_id),
  unique (committee_id, student_id)
);
create index if not exists committee_members_committee_idx on public.committee_members (committee_id);

alter table public.committees enable row level security;
alter table public.committee_members enable row level security;
revoke all on public.committees, public.committee_members from anon;
grant select, insert, update, delete on public.committees, public.committee_members to authenticated;

drop policy if exists committees_edit on public.committees;
create policy committees_edit on public.committees
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists committees_read on public.committees;
create policy committees_read on public.committees
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));

drop policy if exists committee_members_edit on public.committee_members;
create policy committee_members_edit on public.committee_members
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists committee_members_read on public.committee_members;
create policy committee_members_read on public.committee_members
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));



-- ================================================================
-- discipline.sql
-- ================================================================
-- Discipline register (سجل المخالفات / سجل الضبط): a student's violations and warnings with the date, the violation and the action taken.
-- Edited by the superadmin and the registrar; read by the manager and the supervisor.
-- Run this file once in the Supabase SQL Editor, after registrar.sql, manager.sql and attendance_supervisor.sql. It does not change existing data.

create table if not exists public.discipline_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  day date not null default current_date,
  kind text not null default 'violation' check (kind in ('violation', 'warning')),   -- مخالفة أو إنذار
  violation text not null default '',
  action text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists discipline_records_student_idx on public.discipline_records (student_id, day);
create index if not exists discipline_records_day_idx on public.discipline_records (day);

alter table public.discipline_records enable row level security;
revoke all on public.discipline_records from anon;
grant select, insert, update, delete on public.discipline_records to authenticated;

drop policy if exists discipline_edit on public.discipline_records;
create policy discipline_edit on public.discipline_records
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists discipline_read on public.discipline_records;
create policy discipline_read on public.discipline_records
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));



-- ================================================================
-- parent_accounts.sql
-- ================================================================
-- حسابات أولياء الأمور: حساب واحد لكل ولي أمر، يدخل برقم هويته وكلمة مرور على parent.html فيرى كل أبنائه:
-- الحضور والغياب، والدرجات، وأرشيف الرسائل التي أُرسلت إليه، ومعها المواصلات وجدول الحصص كما في الرابط.
-- الحساب مبني على رابط ولي الأمر (parent_links): كلمة المرور تُحفظ مُشفّرة (bcrypt) ولا تظهر لأحد بعد إنشائها.
-- يُنشئ المدير العام كلمة المرور أو يعيد تعيينها من «روابط أولياء الأمور». بعد 5 محاولات خاطئة يُقفل الدخول 15 دقيقة.
-- شغّل هذا الملف مرة في محرر SQL في Supabase، بعد parent_links.sql و teacher_grades.sql و whatsapp_messages.sql. لا يغيّر أي بيانات موجودة.

create extension if not exists pgcrypto;

alter table public.parent_links add column if not exists pass_hash text;
alter table public.parent_links add column if not exists pass_set_at timestamptz;
alter table public.parent_links add column if not exists fails int not null default 0;
alter table public.parent_links add column if not exists locked_until timestamptz;
alter table public.parent_links add column if not exists last_login timestamptz;

-- المدير العام: كلمة مرور لولي أمر (بمفتاحه id:رقم الهوية). يُنشأ الرابط إن لم يوجد
create or replace function public.parent_set_password(p_key text, p_pass text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'للمدير العام فقط'; end if;
  if p_key !~ '^id:[0-9]{5,}$' then raise exception 'الحساب يحتاج رقم هوية ولي الأمر في ملف التسجيل'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'كلمة المرور 6 أحرف على الأقل'; end if;
  insert into parent_links (guardian_key) values (p_key) on conflict (guardian_key) do nothing;
  update parent_links set pass_hash = crypt(p_pass, gen_salt('bf')), pass_set_at = now(), fails = 0, locked_until = null, active = true
  where guardian_key = p_key;
end $$;
revoke all on function public.parent_set_password(text, text) from public;
grant execute on function public.parent_set_password(text, text) to authenticated;

-- الدخول: رقم الهوية وكلمة المرور ← رمز الجلسة (رمز الرابط نفسه)
create or replace function public.parent_login(p_id text, p_pass text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l record; k text;
begin
  k := 'id:' || regexp_replace(translate(coalesce(p_id, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
  select * into l from parent_links where guardian_key = k;
  if l.token is null or l.pass_hash is null then return jsonb_build_object('error', 'رقم الهوية أو كلمة المرور غير صحيحة'); end if;
  if not l.active then return jsonb_build_object('error', 'الحساب موقوف. تواصل مع إدارة الأكاديمية.'); end if;
  if l.locked_until is not null and l.locked_until > now() then return jsonb_build_object('error', 'محاولات كثيرة خاطئة. حاول بعد 15 دقيقة.'); end if;
  if crypt(coalesce(p_pass, ''), l.pass_hash) <> l.pass_hash then
    update parent_links set fails = case when fails + 1 >= 5 then 0 else fails + 1 end,
      locked_until = case when fails + 1 >= 5 then now() + interval '15 minutes' end where token = l.token;
    return jsonb_build_object('error', 'رقم الهوية أو كلمة المرور غير صحيحة');
  end if;
  update parent_links set fails = 0, locked_until = null, last_login = now() where token = l.token;
  return jsonb_build_object('token', l.token);
end $$;
revoke all on function public.parent_login(text, text) from public;
grant execute on function public.parent_login(text, text) to anon, authenticated;

-- ما يُضاف لشاشة ولي الأمر: الدرجات لكل ابن، وأرشيف الرسائل المرسلة إليه
create or replace function public.parent_more(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; ids uuid[]; kids jsonb; msgs jsonb;
begin
  select guardian_key into k from parent_links where token = p_token and active;
  if k is null then return jsonb_build_object('error', 'غير مسموح'); end if;
  select array_agg(s.id) into ids from students s where s.status in ('final', 'reserve') and public.parent_key(s.details, s.phone, s.id) = k;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name,
      'grades', (select coalesce(jsonb_agg(jsonb_build_object('term', i.term, 'subject', g.subject, 'item', i.name, 'max', i.max_score, 'score', g.score, 'sort', i.sort)
                   order by i.term, g.subject, i.sort), '[]'::jsonb)
                 from grades g join grade_items i on i.id = g.item_id where g.student_id = s.id and g.score is not null))), '[]'::jsonb)
  into kids from students s where s.id = any (coalesce(ids, '{}'));
  select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'title', m.title, 'body', m.body, 'status', m.status) order by m.created_at desc), '[]'::jsonb)
  into msgs from (select * from wa_messages m where m.student_ids && (select array_agg(x::text) from unnest(coalesce(ids, '{}')) x)
                  and m.status not in ('nophone', 'rejected', 'cancelled') order by m.created_at desc limit 100) m;
  return jsonb_build_object('kids', kids, 'messages', msgs);
end $$;
revoke all on function public.parent_more(text) from public;
grant execute on function public.parent_more(text) to anon, authenticated;



-- ================================================================
-- protect_payments.sql
-- ================================================================
-- Protects transport payments from disappearing with a deleted student record.
-- Until now deleting a student also deleted that student's payments (on delete cascade).
-- After this file the database itself refuses to delete a student who still has payments:
-- the receipts have to be moved to the student's other record, voided (kept in the archive) or refunded first.
-- The page already does this check; this makes it hold whatever page or tool sends the delete.
-- Run this file once in the Supabase SQL Editor. It does not change existing data.

do $$
declare
  fk text;
begin
  for fk in
    select conname from pg_constraint
    where conrelid = 'public.transport_payments'::regclass
      and confrelid = 'public.students'::regclass
      and contype = 'f'
  loop
    execute format('alter table public.transport_payments drop constraint %I', fk);
  end loop;
  alter table public.transport_payments
    add constraint transport_payments_student_id_fkey
    foreign key (student_id) references public.students (id) on delete restrict;
end $$;



-- ================================================================
-- receipt_archive.sql
-- ================================================================
-- Archive of deleted (voided) transport receipts.
-- Deleting a receipt removes the payment, so the student owes that month again,
-- while a copy of the receipt is kept here with who deleted it, when and why.
-- Run this file once in the Supabase SQL Editor, after transport.sql. It does not change existing data.

create table if not exists public.transport_voided (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint,                              -- the number the receipt carried
  student_id uuid references public.students (id) on delete set null,
  student_name text not null default '',          -- kept as text so the record survives changes to the student
  class_name text not null default '',
  assembly_point text not null default '',
  month text not null,                            -- "2026-10"
  amount numeric not null default 0,
  method text not null default 'cash',
  method_note text not null default '',
  paid_on date,
  reason text not null default '',
  voided_by text not null default '',
  voided_at timestamptz not null default now()
);
create index if not exists transport_voided_at_idx on public.transport_voided (voided_at desc);

alter table public.transport_voided enable row level security;
revoke all on public.transport_voided from anon;
grant select, insert, update, delete on public.transport_voided to authenticated;

-- Like the payments themselves: the superadmin only.
drop policy if exists transport_voided_admin on public.transport_voided;
create policy transport_voided_admin on public.transport_voided
  for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');



-- ================================================================
-- receipts_due.sql
-- ================================================================
-- The fee due at the moment a receipt is issued is kept with the receipt ("due").
-- From then on that month's fee for that student is what the receipt says, whatever happens later in the
-- family (another sibling paying, a sibling stopping): issued receipts are never re-priced.
-- Receipts issued before this file have no "due" and keep being computed as before.
-- Run this file once in the Supabase SQL Editor. It does not change existing data.

alter table public.transport_payments
  add column if not exists due numeric;



-- ================================================================
-- receipts_lock.sql
-- ================================================================
-- Issued receipts are locked in the database itself, not only on the page.
-- A transport payment row with an amount is a receipt. From the app (any account, the superadmin included):
--   * its number, month, payment method and payment reference never change;
--   * its amount may only go up (a top-up for the rest of the month's fee, same method);
--   * it goes down only through a refund recorded in transport_refunds a moment before;
--   * it is deleted only after a copy was saved to the archive (transport_voided) or it was refunded in full;
--   * it moves to another student record only when both records carry the same national ID (merging a duplicate).
-- Work done directly in the Supabase SQL Editor (as postgres) is not blocked, for supervised corrections.
-- Run this file once in the Supabase SQL Editor, after transport.sql, transport_refunds.sql and receipt_archive.sql.
-- It does not change existing data.

create or replace function public.guard_transport_receipt()
returns trigger
language plpgsql
-- not security definer: current_user must stay the caller, to tell the app (authenticated) from the SQL Editor (postgres)
set search_path = public
as $$
declare
  ok boolean;
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.amount, 0) <= 0 then
      return new; -- not a receipt yet
    end if;
    if new.receipt_no is distinct from old.receipt_no or new.month <> old.month
       or coalesce(new.method, '') <> coalesce(old.method, '')
       or coalesce(new.method_note, '') <> coalesce(old.method_note, '') then
      raise exception 'لا يُعدَّل إيصال مسجَّل (رقمه أو شهره أو وسيلة الدفع أو رقم الدفع). احذفه إلى أرشيف الإيصالات وأصدر إيصالًا جديدًا.';
    end if;
    if new.student_id <> old.student_id then
      select exists (
        select 1 from public.students a join public.students b on b.national_id = a.national_id
        where a.id = old.student_id and b.id = new.student_id and coalesce(a.national_id, '') <> ''
      ) into ok;
      if not ok then
        raise exception 'لا يُنقل إيصال إلى طالب آخر.';
      end if;
    end if;
    if new.amount < old.amount then
      select exists (
        select 1 from public.transport_refunds r
        where r.student_id = old.student_id and r.month = old.month
          and r.paid_before = old.amount and r.amount = old.amount - new.amount
          and r.created_at > now() - interval '15 minutes'
      ) into ok;
      if not ok then
        raise exception 'لا يُخفَّض مبلغ إيصال مسجَّل إلا بالاسترداد.';
      end if;
    end if;
    return new;
  end if;

  -- DELETE
  if coalesce(old.amount, 0) > 0 then
    select exists (
      select 1 from public.transport_voided v
      where v.student_id = old.student_id and v.month = old.month
        and v.receipt_no is not distinct from old.receipt_no and v.voided_at > now() - interval '1 hour'
    ) or exists (
      select 1 from public.transport_refunds r
      where r.student_id = old.student_id and r.month = old.month
        and r.paid_before = old.amount and r.amount = old.amount
        and r.created_at > now() - interval '15 minutes'
    ) into ok;
    if not ok then
      raise exception 'لا يُحذف إيصال مسجَّل إلا بحذفه إلى أرشيف الإيصالات (بسبب مكتوب) أو باسترداده كاملًا.';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists transport_receipt_guard on public.transport_payments;
create trigger transport_receipt_guard
  before update or delete on public.transport_payments
  for each row execute function public.guard_transport_receipt();



-- ================================================================
-- registrar.sql
-- ================================================================
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
-- النسخة المعتمدة من create_user_account في attendance_clerk.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'create_user_account' and pronamespace = 'public'::regnamespace) then
    execute $fn$
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
$$
    $fn$;
  end if;
end $guard$;

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



-- ================================================================
-- registrar_transport.sql
-- ================================================================
-- المسجِّل في «المواصلات»: يرى الباصات ودفعات الطلاب وسجلها، ويضيف الطلاب إلى الباصات ويزيلهم، ويصدر الإيصالات
-- (الإيصال الأول والإيصالات المكمِّلة). لا يحذف إيصالًا ولا يلغيه ولا يسترد ولا يعفي ولا يعدّل الرسوم والدورات والباصات نفسها،
-- ولا يرى إيصالات الموظفين. حماية الإيصالات المسجَّلة (receipts_lock.sql) تبقى على الجميع: لا يُخفَّض إيصال ولا يُعدَّل رقمه.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد registrar.sql و transport.sql و transport_topups.sql و transport_refunds.sql)،
-- ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات.

drop policy if exists transport_payments_registrar_read on public.transport_payments;
create policy transport_payments_registrar_read on public.transport_payments
  for select to authenticated using (public.my_role() = 'registrar');
drop policy if exists transport_payments_registrar_insert on public.transport_payments;
create policy transport_payments_registrar_insert on public.transport_payments
  for insert to authenticated with check (public.my_role() = 'registrar');
drop policy if exists transport_payments_registrar_update on public.transport_payments;
create policy transport_payments_registrar_update on public.transport_payments
  for update to authenticated using (public.my_role() = 'registrar') with check (public.my_role() = 'registrar');

do $$
begin
  if to_regclass('public.transport_topups') is not null then
    drop policy if exists transport_topups_registrar_read on public.transport_topups;
    create policy transport_topups_registrar_read on public.transport_topups
      for select to authenticated using (public.my_role() = 'registrar');
    drop policy if exists transport_topups_registrar_insert on public.transport_topups;
    create policy transport_topups_registrar_insert on public.transport_topups
      for insert to authenticated with check (public.my_role() = 'registrar');
  end if;
  -- المبالغ تُعرض صافية بعد الاسترداد، فيقرأ المسترَدّ (ولا يسجّله)
  if to_regclass('public.transport_refunds') is not null then
    drop policy if exists transport_refunds_registrar_read on public.transport_refunds;
    create policy transport_refunds_registrar_read on public.transport_refunds
      for select to authenticated using (public.my_role() = 'registrar');
  end if;
end $$;



-- ================================================================
-- staff_cv.sql
-- ================================================================
-- سيرة ذاتية منسّقة لكل موظف تُعرض برابط على الموقع (cv.html?t=…) من بطاقة المؤهلات المراجَعة.
-- الرابط مغلق حتى يفعّله المدير العام أو المدير من بطاقة الموظف، ويمكن إيقافه أو تغييره. وسائل التواصل وتاريخ الميلاد والعنوان
-- لا تظهر إلا إن اختيرت. شغّله بعد staff_profiles.sql. لا يغيّر أي بيانات موجودة.

alter table public.staff_profiles
  add column if not exists cv_token text unique,
  add column if not exists cv_public boolean not null default false,
  add column if not exists cv_contact boolean not null default false;

create or replace function public.staff_cv(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p staff_profiles; t teachers; d jsonb;
begin
  if coalesce(length(p_token), 0) < 20 then return null; end if;
  select * into p from staff_profiles where cv_token = p_token and cv_public and reviewed;
  if not found then return null; end if;
  select * into t from teachers where id = p.staff_id;
  d := p.data - 'unsure' - 'pages' - 'has';
  if not p.cv_contact then d := d - 'phone' - 'email' - 'address' - 'birth_date'; end if;
  return jsonb_build_object(
    'school', coalesce((select nullif(to_jsonb(st) ->> 'school_name', '') from settings st where st.id = 1), 'أكاديمية الركيزة الثالثة'),
    'name', t.name, 'job_title', coalesce(to_jsonb(t) ->> 'job_title', ''), 'subject', coalesce(to_jsonb(t) ->> 'subject', ''),
    'data', d, 'updated', p.updated_at);
end $$;
revoke all on function public.staff_cv(text) from public;
grant execute on function public.staff_cv(text) to anon, authenticated;



-- ================================================================
-- student_exits.sql
-- ================================================================
-- Student exit permits (إذن خروج الطلاب أثناء الدوام): who left school, on which day, at what time and why.
-- Edited by the superadmin and the registrar; read by the manager and the supervisor.
-- Run this file once in the Supabase SQL Editor, after registrar.sql, manager.sql and attendance_supervisor.sql. It does not change existing data.

create table if not exists public.student_exits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  day date not null default current_date,
  exit_time time,                      -- ساعة الخروج
  reason text not null default '',     -- سبب الخروج
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists student_exits_day_idx on public.student_exits (day);
create index if not exists student_exits_student_idx on public.student_exits (student_id, day);

alter table public.student_exits enable row level security;
revoke all on public.student_exits from anon;
grant select, insert, update, delete on public.student_exits to authenticated;

drop policy if exists student_exits_edit on public.student_exits;
create policy student_exits_edit on public.student_exits
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_exits_read on public.student_exits;
create policy student_exits_read on public.student_exits
  for select to authenticated using (public.my_role() in ('manager', 'supervisor'));



-- ================================================================
-- student_leaves.sql
-- ================================================================
-- إجازات الطلاب (عذر غياب لفترة، مثل عملية جراحية لأسبوع): من تاريخ إلى تاريخ، وسببها.
-- كل حضور يُسجَّل لطالب في أيام إجازته يُحفظ «مأذون» تلقائيًا، من أي مكان سُجِّل: الموقع، وتطبيق الموبايل، وروابط المعلمين، وبوت الغياب.
-- وعند إضافة إجازة تُحوَّل أيامها المسجَّلة من قبل إلى «مأذون». وفي الموبايل يظهر الطالب المجاز مُعلَّمًا من البداية.
-- يضيفها ويحذفها المدير العام والمسجِّل، ويراها كل من يرى الحضور. شغّل هذا الملف مرة في محرر SQL في Supabase، بعد attendance.sql و api.sql.
-- (إن أعدتَ تشغيل api.sql لاحقًا فأعد تشغيل هذا الملف بعده، لأنه يعدّل دالة api_att_roll)

create table if not exists public.student_leaves (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  from_day date not null,
  to_day date not null,
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists student_leaves_student_idx on public.student_leaves (student_id, from_day, to_day);

alter table public.student_leaves enable row level security;
revoke all on public.student_leaves from anon;
grant select, insert, update, delete on public.student_leaves to authenticated;

drop policy if exists student_leaves_edit on public.student_leaves;
create policy student_leaves_edit on public.student_leaves
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_leaves_read on public.student_leaves;
create policy student_leaves_read on public.student_leaves
  for select to authenticated using (coalesce(public.my_role(), 'pending') <> 'pending');

-- الحضور في يوم إجازة يُحفظ «مأذون»، وملاحظته سبب الإجازة إن لم تُكتب ملاحظة
-- النسخة المعتمدة من attendance_apply_leave في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'attendance_apply_leave' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.attendance_apply_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select reason into l from student_leaves
  where student_id = new.student_id and new.day between from_day and to_day
  order by created_at desc limit 1;
  if found and new.status <> 'excused' then
    new.status := 'excused';
    if coalesce(new.note, '') = '' then new.note := 'إجازة' || case when l.reason <> '' then ': ' || l.reason else '' end; end if;
  end if;
  return new;
end $$
    $fn$;
  end if;
end $guard$;
drop trigger if exists attendance_apply_leave on public.attendance;
create trigger attendance_apply_leave before insert or update on public.attendance
  for each row execute function public.attendance_apply_leave();

-- عند إضافة إجازة أو تعديلها: أيامها المسجَّلة من قبل تصير «مأذون»
create or replace function public.student_leave_backfill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update attendance set status = 'excused', updated_at = now()
  where student_id = new.student_id and day between new.from_day and new.to_day and status <> 'excused';
  return new;
end $$;
drop trigger if exists student_leave_backfill on public.student_leaves;
create trigger student_leave_backfill after insert or update on public.student_leaves
  for each row execute function public.student_leave_backfill();

-- كشف الشعبة في تطبيق الموبايل: الطالب المجاز اليوم يظهر مُعلَّمًا (غائبًا بعذر) من البداية
-- النسخة المعتمدة من api_att_roll في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_roll' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))
             or exists (select 1 from student_leaves l where l.student_id = r.id and att_today() between l.from_day and l.to_day),
      'leave', (select l.reason from student_leaves l where l.student_id = r.id and att_today() between l.from_day and l.to_day order by l.created_at desc limit 1)) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

-- قالب رسالة الإجازة لولي الأمر: يُعدَّل من «رسائل واتساب» ← «القوالب».
-- {الاسم} {من} {إلى} {السبب} {التمني} {الأكاديمية} تُستبدل عند الإرسال (التمني بحسب نوع الإجازة: مرض، سفر…)
insert into public.wa_templates (key, title, body, sort) values
  ('leave', 'إجازة طالب', E'السلام عليكم ورحمة الله وبركاته،\nولي أمر الطالب/ة {الاسم} المحترم،\nنفيدكم بأنه تم تسجيل إجازة لابنكم/ابنتكم من {من} إلى {إلى} بسبب {السبب}، ولن يُحتسب غيابه/ا خلالها.\n{التمني}.\n{الأكاديمية}', 6)
on conflict (key) do nothing;



-- ================================================================
-- student_registration.sql
-- ================================================================
-- Student registration in two stages: preliminary (from the form) then final (checked at school).
-- Run this file once in the Supabase SQL Editor, after students.sql.

alter table public.students
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'final')),
  add column if not exists finalized_at timestamptz,
  add column if not exists gender text not null default '',
  add column if not exists email text not null default '',
  add column if not exists requested_class text not null default '',     -- the class as written in the form
  add column if not exists form_key text unique,                         -- the form response this record came from
  add column if not exists form_answers jsonb not null default '{}'::jsonb,   -- the answers exactly as the guardian wrote them
  add column if not exists documents jsonb not null default '{}'::jsonb,      -- which documents were handed in
  add column if not exists documents_note text not null default '';

-- Preliminary records come straight from the form, where ID numbers can be missing, mistyped or repeated,
-- so the ID is only required to be unique among finally-registered students.
alter table public.students alter column national_id set default '';
alter table public.students drop constraint if exists students_national_id_key;
create unique index if not exists students_final_national_id
  on public.students (national_id)
  where status = 'final' and national_id <> '';

create index if not exists students_status_idx on public.students (status);

-- Whether the student needs school transport: true, false, or null while not yet asked.
alter table public.students add column if not exists wants_transport boolean;

-- The fuller final-registration file (schooling, guardian, family, health, housing...).
-- These answers are kept together as JSON so fields can be added later without another migration.
alter table public.students add column if not exists details jsonb not null default '{}'::jsonb;



-- ================================================================
-- student_suspensions.sql
-- ================================================================
-- الفصل المؤقت التأديبي: فترة فصل لطالب (من تاريخ إلى تاريخ، وسببها)، تُسجَّل من «إدارة شئون الطلاب» ← «الفصل المؤقت».
-- يُحفظ في جدول إجازات الطلاب نفسه بنوع suspension، فيسري عليه ما يسري على الإجازة:
-- كل حضور يُسجَّل للطالب في أيام فصله يُحفظ «مأذون» تلقائيًا (فلا يُحتسب غيابًا)، من الموقع وتطبيق الموبايل وروابط المعلمين وبوت الغياب،
-- ويظهر في كشوف الحضور بعلامة «ف». يضيفه ويحذفه المدير العام والمسجِّل.
-- شغّل هذا الملف مرة في محرر SQL في Supabase، بعد student_leaves.sql.
-- (إن أعدتَ تشغيل api.sql أو attendance_clerk.sql أو student_leaves.sql لاحقًا فأعد تشغيل هذا الملف بعدها، لأنه يعدّل دالة api_att_roll)

alter table public.student_leaves add column if not exists kind text not null default 'leave';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'student_leaves_kind_check') then
    alter table public.student_leaves add constraint student_leaves_kind_check check (kind in ('leave', 'suspension'));
  end if;
end $$;

-- الحضور في يوم إجازة أو فصل يُحفظ «مأذون»، وملاحظته «إجازة: …» أو «فصل مؤقت: …» إن لم تُكتب ملاحظة
create or replace function public.attendance_apply_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select reason, kind into l from student_leaves
  where student_id = new.student_id and new.day between from_day and to_day
  order by (kind = 'suspension') desc, created_at desc limit 1;
  if found and new.status <> 'excused' then
    new.status := 'excused';
    if coalesce(new.note, '') = '' then
      new.note := case when l.kind = 'suspension' then 'فصل مؤقت' else 'إجازة' end || case when l.reason <> '' then ': ' || l.reason else '' end;
    end if;
  end if;
  return new;
end $$;

-- كشف الشعبة في تطبيق الموبايل: المجاز أو المفصول اليوم يظهر مُعلَّمًا من البداية، ومعه السبب.
-- للمعلم والمدير العام ومسجِّل الحضور
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))
             or exists (select 1 from student_leaves l where l.student_id = r.id and att_today() between l.from_day and l.to_day),
      'leave', (select case when l.kind = 'suspension' then 'فصل مؤقت' || case when l.reason <> '' then ': ' || l.reason else '' end else l.reason end
                from student_leaves l where l.student_id = r.id and att_today() between l.from_day and l.to_day
                order by (l.kind = 'suspension') desc, l.created_at desc limit 1)) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$;
grant execute on function public.api_att_roll(text) to authenticated;

-- قالب رسالة الفصل المؤقت لولي الأمر: يُعدَّل من «رسائل واتساب» ← «القوالب».
-- {الاسم} {من} {إلى} {السبب} {الأكاديمية} تُستبدل عند الإرسال
insert into public.wa_templates (key, title, body, sort) values
  ('suspension', 'فصل طالب', E'السلام عليكم ورحمة الله وبركاته،\nولي أمر الطالب/ة {الاسم} المحترم،\nنحيطكم علمًا بأنه تقرر فصل ابنكم/ابنتكم فصلًا مؤقتًا من {من} إلى {إلى} بسبب {السبب}.\nيُرجى مراجعة إدارة الأكاديمية.\n{الأكاديمية}', 7)
on conflict (key) do nothing;



-- ================================================================
-- teacher_grades.sql
-- ================================================================
-- صفوف المعلم ودرجات الطلاب.
-- 1) my_classes / my_students: يرى المعلم (بحسابه) بيانات طلاب الشعب التي يدرّسها في جدول الحصص فقط:
--    الاسم، والشعبة، وتاريخ الميلاد، والسكن، وجوال الطالب، وجوال ولي الأمر، والجوال البديل.
-- 2) grade_items: إعداد الدرجات من الإدارة (المدير العام): لكل فصل دراسي اختباراته ودرجة كلٍّ منها (اختبار أكتوبر 10، نصف الفصل 30…).
-- 3) grades: يرصد المعلم درجات طلابه في مواده هو فقط؛ والمدير العام والمدير يرون الكل، والمدير العام يعدّل.
-- شغّل هذا الملف مرة في محرر SQL في Supabase، بعد timetable.sql و teacher_papers.sql. لا يغيّر أي بيانات موجودة.

create or replace function public.my_classes() returns table (class_name text, subject text)
language sql stable security definer set search_path = public as $$
  select distinct s.class_name, s.subject from timetable_sessions s
  where s.teacher_id = public.my_teacher_id() and s.status <> 'removed' and s.class_name <> ''
  order by 1, 2
$$;
grant execute on function public.my_classes() to authenticated;

create or replace function public.my_students() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'full_name', x.full_name, 'class_name', x.class_name, 'birth_date', x.birth_date, 'gender', x.gender,
      'address', x.address, 'city', x.details ->> 'city', 'neighborhood', x.details ->> 'neighborhood',
      'student_phone', coalesce(nullif(x.details ->> 'student_phone', ''), x.whatsapp), 'guardian_name', x.guardian_name,
      'phone', x.phone, 'alt_phone', x.details ->> 'alt_phone') order by x.class_name, x.full_name), '[]'::jsonb)
  from students x
  where x.status in ('final', 'reserve')
    and x.class_name in (select c.class_name from public.my_classes() c)
$$;
grant execute on function public.my_students() to authenticated;

create table if not exists public.grade_items (
  id uuid primary key default gen_random_uuid(),
  term text not null default 'الفصل الدراسي الأول',
  name text not null,
  max_score numeric not null check (max_score > 0),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.grade_items enable row level security;
revoke all on public.grade_items from anon;
grant select, insert, update, delete on public.grade_items to authenticated;
drop policy if exists grade_items_read on public.grade_items;
create policy grade_items_read on public.grade_items for select to authenticated using (coalesce(public.my_role(), 'pending') <> 'pending');
drop policy if exists grade_items_edit on public.grade_items;
create policy grade_items_edit on public.grade_items for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

create table if not exists public.grades (
  student_id uuid not null references public.students (id) on delete cascade,
  item_id uuid not null references public.grade_items (id) on delete cascade,
  subject text not null,
  score numeric,
  teacher_id uuid,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, item_id, subject)
);
alter table public.grades enable row level security;
revoke all on public.grades from anon;
grant select, insert, update, delete on public.grades to authenticated;

-- المعلم: طلاب شعبه في مواده هو
create or replace function public.grade_mine(p_student uuid, p_subject text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students x join timetable_sessions s on s.class_name = x.class_name
    where x.id = p_student and s.subject = p_subject and s.status <> 'removed' and s.teacher_id = public.my_teacher_id())
$$;
grant execute on function public.grade_mine(uuid, text) to authenticated;

drop policy if exists grades_teacher on public.grades;
create policy grades_teacher on public.grades for all to authenticated
  using (public.grade_mine(student_id, subject)) with check (public.grade_mine(student_id, subject));
drop policy if exists grades_admin on public.grades;
create policy grades_admin on public.grades for all to authenticated
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select to authenticated using (public.my_role() in ('manager', 'supervisor'));



-- ================================================================
-- visit_approval.sql
-- ================================================================
-- Approval of supervisory visit reports by the manager (مدير الأكاديمية).
-- The supervisor writes and prints the report; it prints with «بانتظار اعتماد المدير» until the manager (or the superadmin) approves it,
-- then prints as approved with the approver's name and date. Editing an approved report cancels its approval (the app clears it).
-- Run this file once in the Supabase SQL Editor, after visits.sql and manager.sql. It does not change existing data.

alter table public.visits add column if not exists approved_by text not null default '';
alter table public.visits add column if not exists approved_at timestamptz;

-- The manager has no write access to visits; approval goes through this function only.
create or replace function public.set_visit_approval(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare who text;
begin
  if public.my_role() not in ('manager', 'superadmin') then raise exception 'غير مسموح'; end if;
  if p_approve and public.my_role() = 'manager' and exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce((to_jsonb(p) ->> 'read_only')::boolean, false)) then
    raise exception 'غير مسموح';
  end if;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();
  update public.visits
     set approved_by = case when p_approve then coalesce(who, '') else '' end,
         approved_at = case when p_approve then now() else null end
   where id = p_id;
end $$;
revoke all on function public.set_visit_approval(uuid, boolean) from public, anon;
grant execute on function public.set_visit_approval(uuid, boolean) to authenticated;



-- ================================================================
-- attendance_links.sql
-- ================================================================
-- Recording absences without an account: from a private link (absence.html) or by WhatsApp through n8n.
-- Each teacher gets a secret link token. n8n holds one bot key; with it, it can ask the database what to
-- reply to a teacher's WhatsApp message, list the morning links, and list classes not yet recorded.
-- Everything goes through the functions below; the tables themselves are for the superadmin only.
-- Run this file once in the Supabase SQL Editor, after attendance.sql. It does not change existing data.

create table if not exists public.attendance_tokens (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  name text not null,
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_settings (
  id int primary key default 1 check (id = 1),
  bot_key text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
insert into public.attendance_settings (id) values (1) on conflict (id) do nothing;

-- Where each teacher is in the WhatsApp conversation (choosing a class, then sending absentees).
create table if not exists public.attendance_bot_state (
  phone text primary key,
  step text not null,
  class_name text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.attendance_tokens enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.attendance_bot_state enable row level security;
revoke all on public.attendance_tokens, public.attendance_settings, public.attendance_bot_state from anon;
grant select, insert, update, delete on public.attendance_tokens, public.attendance_settings to authenticated;

drop policy if exists attendance_tokens_admin on public.attendance_tokens;
create policy attendance_tokens_admin on public.attendance_tokens
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists attendance_settings_admin on public.attendance_settings;
create policy attendance_settings_admin on public.attendance_settings
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
-- attendance_bot_state: no policy, so only the functions below (security definer) touch it.

-- ---------- helpers ----------

-- Today in Egypt.
create or replace function public.att_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- Phone in the form WhatsApp uses: 20 + number (Egyptian numbers written 01xxxxxxxxx).
create or replace function public.att_phone(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^0[0-9]{10}$' then '2' || d
    when d ~ '^00' then substr(d, 3)
    else d end
  from (select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') as d) x
$$;

-- Classes that have finally registered students, in the order of «إعداد الفصول», then by name.
create or replace function public.att_classes() returns table (pos int, class_name text, students int)
language sql stable security definer set search_path = public as $$
  with c as (
    select s.class_name, count(*)::int as students
    from students s where s.status = 'final' and s.class_name <> ''
    group by s.class_name
  ), cfg as (
    select e.value ->> 'name' as name, e.ordinality as ord
    from settings st, jsonb_array_elements(coalesce(st.classes -> 'list', '[]'::jsonb)) with ordinality e
    where st.id = 1
  )
  select (row_number() over (order by coalesce(cfg.ord, 100000), c.class_name))::int, c.class_name, c.students
  from c left join cfg on cfg.name = c.class_name
$$;

-- The finally registered students of a class, numbered the same way every time.
create or replace function public.att_roll(p_class text) returns table (pos int, id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select (row_number() over (order by s.full_name, s.id))::int, s.id, s.full_name
  from students s where s.status = 'final' and s.class_name = p_class
$$;

-- Records a class for today: the given students absent, everyone else present.
-- A student already recorded as excused (مأذون) from the app stays excused while the list still shows them as absent.
create or replace function public.att_save(p_class text, p_absent uuid[], p_by text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into attendance (student_id, day, status, note, class_name, recorded_by, updated_at)
  select s.id, att_today(), case when s.id = any(coalesce(p_absent, '{}')) then
           case when exists (select 1 from attendance a where a.student_id = s.id and a.day = att_today() and a.status = 'excused') then 'excused' else 'absent' end
         else 'present' end,
         coalesce((select a.note from attendance a where a.student_id = s.id and a.day = att_today()), ''),
         p_class, p_by, now()
  from students s where s.status = 'final' and s.class_name = p_class
  on conflict (student_id, day) do update
    set status = excluded.status, class_name = excluded.class_name, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.att_token_name(p_token text) returns text
language sql stable security definer set search_path = public as $$
  select name from attendance_tokens where token = p_token and active
$$;

-- ---------- the private link (absence.html) ----------

create or replace function public.absence_classes(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare who text := att_token_name(p_token);
begin
  if who is null then return jsonb_build_object('error', 'الرابط غير صالح أو أُلغي'); end if;
  return jsonb_build_object('teacher', who, 'day', att_today(), 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.class_name, 'students', c.students,
      'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name)) order by c.pos)
    from att_classes() c), '[]'::jsonb));
end $$;

create or replace function public.absence_roll(p_token text, p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if att_token_name(p_token) is null then return jsonb_build_object('error', 'الرابط غير صالح أو أُلغي'); end if;
  return jsonb_build_object('students', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb),
    'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class));
end $$;

create or replace function public.absence_submit(p_token text, p_class text, p_absent uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text := att_token_name(p_token); n int;
begin
  if who is null then return jsonb_build_object('error', 'الرابط غير صالح أو أُلغي'); end if;
  if not exists (select 1 from att_classes() c where c.class_name = p_class) then return jsonb_build_object('error', 'الشعبة غير موجودة'); end if;
  n := att_save(p_class, p_absent, who);
  return jsonb_build_object('saved', n, 'absent', coalesce((
    select jsonb_agg(r.full_name order by r.pos) from att_roll(p_class) r where r.id = any(coalesce(p_absent, '{}'))), '[]'::jsonb));
end $$;

-- ---------- n8n (with the bot key) ----------

-- The key is hex; anything else in what n8n sends (a line break or space picked up when pasting, an invisible
-- direction mark from an Arabic page) is ignored, so a correctly copied key is never refused for an unseen character.
create or replace function public.att_bot_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from attendance_settings
                 where id = 1 and length(regexp_replace(coalesce(p_key, ''), '[^0-9A-Fa-f]', '', 'g')) >= 32
                   and lower(regexp_replace(bot_key, '[^0-9A-Fa-f]', '', 'g')) = lower(regexp_replace(coalesce(p_key, ''), '[^0-9A-Fa-f]', '', 'g')))
$$;

-- The morning message: each active teacher with a phone, and their link token.
create or replace function public.absence_links(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', name, 'phone', att_phone(phone), 'token', token) order by name)
    from attendance_tokens where active and att_phone(phone) <> ''), '[]'::jsonb);
end $$;

-- Classes not yet recorded today, as a ready message ('' when all are recorded).
create or replace function public.absence_missing(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare missing text;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  select string_agg('• ' || c.class_name, E'\n' order by c.pos) into missing
  from att_classes() c
  where not exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name);
  return jsonb_build_object('text', case when missing is null then ''
    else 'لم يُسجَّل غياب هذه الشعب اليوم ' || to_char(att_today(), 'DD/MM/YYYY') || E':\n' || missing end);
end $$;

-- Arabic text in one form for matching names: no diacritics or tatweel, أ/إ/آ → ا, ى → ي, ة → ه, Western digits,
-- and «عبد الله» / «أبو بكر» written as one word, so «عبدالله» and «عبد الله» are the same.
create or replace function public.att_norm(p text) returns text
language sql immutable as $$
  select regexp_replace(btrim(regexp_replace(
    translate(regexp_replace(lower(coalesce(p, '')), '[ًٌٍَُِّْـ]', '', 'g'),
              'أإآٱىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹،؛',
              'اااايه01234567890123456789,,'),
    '\s+', ' ', 'g')), '(^| )(عبد|ابو) ', '\1\2', 'g')
$$;

-- Students of a class whose name is, or starts with, the given words (first name, or first and father's name…).
create or replace function public.att_name_hits(p_class text, q text) returns table (pos int, id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select r.pos, r.id, r.full_name from att_roll(p_class) r
  where att_norm(r.full_name) = q or left(att_norm(r.full_name), length(q) + 1) = q || ' '
$$;

-- Reads a teacher's list of absentees: numbers from the class list and/or names (first names are enough),
-- separated by commas, new lines or « و ». Returns the students found and, if any entry is unclear,
-- a description of each problem (nothing is saved until every entry is clear).
create or replace function public.att_pick(p_class text, p_text text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t text := att_norm(p_text);
  chunk text; w text; words text[]; i int; part text; n int; total int;
  ids uuid[] := '{}'; probs text[] := '{}'; pending text[];
begin
  select count(*) into total from att_roll(p_class);
  if t in ('0', 'لا يوجد', 'لايوجد', 'لا احد', 'لا غياب', 'الكل حاضر', 'لا احد غائب') then
    return jsonb_build_object('ids', '[]'::jsonb, 'problems', '');
  end if;
  t := regexp_replace(t, '\s*(,|\n| و )\s*', ',', 'g');
  foreach chunk in array string_to_array(t, ',') loop
    chunk := btrim(chunk);
    continue when chunk = '';
    if chunk ~ '^[0-9][0-9 \-]*$' then
      foreach w in array regexp_split_to_array(chunk, '[ \-]+') loop
        continue when w = '';
        if w::int < 1 or w::int > total then
          probs := probs || ('الرقم ' || w || ' ليس في الشعبة (من 1 إلى ' || total || ')');
        else
          ids := ids || (select r.id from att_roll(p_class) r where r.pos = w::int);
        end if;
      end loop;
      continue;
    end if;
    -- the entry as one name; if no student has it, word by word («أحمد يوسف» = two students), keeping عبد/أبو with the next word
    pending := array[chunk];
    if position(' ' in chunk) > 0 and not exists (select 1 from att_name_hits(p_class, chunk)) then
      pending := '{}';
      words := string_to_array(chunk, ' ');
      i := 1;
      while i <= array_length(words, 1) loop
        part := words[i];
        if part in ('عبد', 'ابو', 'ام', 'بن', 'ابن') and i < array_length(words, 1) then part := part || ' ' || words[i + 1]; i := i + 1; end if;
        pending := pending || part;
        i := i + 1;
      end loop;
    end if;
    foreach w in array pending loop
      select count(*) into n from att_name_hits(p_class, w);
      if n = 1 then
        ids := ids || (select h.id from att_name_hits(p_class, w) h);
      elsif n = 0 then
        probs := probs || ('«' || w || '»: لا يوجد في الشعبة طالب بهذا الاسم');
      else
        probs := probs || ('«' || w || '» يطابق ' || n || ' طلاب: ' ||
          (select string_agg(h.pos || ') ' || h.full_name, '، ' order by h.pos) from att_name_hits(p_class, w) h));
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ids', coalesce((select jsonb_agg(distinct x) from unnest(ids) x), '[]'::jsonb), 'problems', array_to_string(probs, E'\n'));
end $$;

-- What the bot says after a class is chosen: no list of names, only how to answer.
create or replace function public.att_bot_prompt(p_class text) returns text
language sql stable security definer set search_path = public as $$
  select 'الشعبة: ' || p_class || ' (' || (select count(*) from att_roll(p_class)) || ' طالبًا)' ||
    coalesce(E'\nسُجّل غيابها اليوم سابقًا؛ الغائبون الآن: ' || nullif((
      select string_agg(r.full_name, '، ' order by r.pos) from att_roll(p_class) r
      where exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))), ''),
      case when exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class) then E'\nسُجّل غيابها اليوم سابقًا: لا غائبين.' else '' end) ||
    E'\n\nأرسل أسماء الغائبين الأولى مفصولة بفاصلة (مثل: أحمد، يوسف) أو أرقامهم، أو 0 إن لم يغب أحد.' ||
    E'\nلعرض الأسماء مرقّمة أرسل «قائمة» · «إلغاء» للخروج'
$$;

-- Reads the absentees for the class in the conversation; saves when every entry is clear.
create or replace function public.att_bot_absent(p_pk text, p_class text, p_text text, p_who text) returns text
language plpgsql security definer set search_path = public as $$
declare res jsonb := att_pick(p_class, p_text); ids uuid[]; names text;
begin
  if res ->> 'problems' <> '' then
    update attendance_bot_state set step = 'absent', class_name = p_class, updated_at = now() where phone = p_pk;
    return 'لم يُحفظ شيء بعد — في الرسالة ما يحتاج توضيحًا:' || E'\n' || (res ->> 'problems') ||
      E'\n\nأعد إرسال الغائبين كلهم (بالأرقام أو بالاسم الأول واسم الأب)، أو «قائمة» لعرض الأسماء.';
  end if;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(res -> 'ids') x;
  select string_agg('• ' || r.full_name, E'\n' order by r.pos) into names from att_roll(p_class) r where r.id = any(coalesce(ids, '{}'));
  perform att_save(p_class, ids, p_who || ' (واتساب)');
  delete from attendance_bot_state where phone = p_pk;
  return '✅ سُجّل غياب ' || p_class || ' ليوم ' || to_char(att_today(), 'DD/MM/YYYY') || E'\n' ||
    case when names is null then 'لا غائبين — الجميع حاضر.' else 'الغائبون (' || array_length(ids, 1) || E'):\n' || names end ||
    E'\n\nللتعديل أرسل «غياب» مرة أخرى.';
end $$;

-- The WhatsApp conversation. n8n passes each incoming message; the reply text comes back ('' = do not reply).
--   «غياب» → numbered classes → class number → names (or numbers) of the absent, or 0 → saved.
--   In one message: «غياب 3 أحمد، يوسف» or «غياب 3 0». «قائمة» shows the class list; «إلغاء» stops.
create or replace function public.absence_bot(p_key text, p_phone text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ph text := att_phone(p_phone);
  pk text := right(att_phone(p_phone), 9);   -- conversation key: same teacher whatever form the number arrives in
  msg text := att_norm(p_text);
  who text; st attendance_bot_state; cls text; rest text; reply text; cnum text;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key: the n8n key does not match the one in the settings screen (الإعدادات والمستخدمون)'); end if;
  -- the number is matched on its last 9 digits, so 010…, +2010…, 0020… and a country code other than Egypt all match
  select name into who from attendance_tokens
  where active and length(ph) >= 9 and right(att_phone(phone), 9) = right(ph, 9) limit 1;
  -- not a registered teacher: stay silent (the note and number are for the n8n execution log only)
  if who is null then return jsonb_build_object('reply', '', 'note', 'number not registered', 'phone', ph); end if;

  select * into st from attendance_bot_state where phone = pk and updated_at > now() - interval '30 minutes';

  if msg in ('الغاء', 'إلغاء') then
    delete from attendance_bot_state where phone = pk;
    return jsonb_build_object('reply', case when st.phone is null then '' else 'أُلغي تسجيل الغياب.' end);
  end if;

  -- «غياب» alone, or «غياب <رقم الشعبة> [الغائبون]»
  if msg ~ '^(ال)?غياب( |$)' or msg = 'غ' then
    rest := btrim(regexp_replace(msg, '^(ال)?غياب', ''));
    if msg = 'غ' then rest := ''; end if;
    insert into attendance_bot_state (phone, step, class_name, updated_at) values (pk, 'class', '', now())
      on conflict (phone) do update set step = 'class', class_name = '', updated_at = now();
    if rest = '' then
      select string_agg(c.pos || ') ' || c.class_name ||
        case when exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name) then ' ✓' else '' end, E'\n' order by c.pos)
        into reply from att_classes() c;
      if reply is null then return jsonb_build_object('reply', 'لا توجد شعب فيها طلاب مسجَّلون.'); end if;
      return jsonb_build_object('reply', 'أهلًا ' || who || E'\nتسجيل غياب يوم ' || to_char(att_today(), 'DD/MM/YYYY') ||
        E'\nأرسل رقم الشعبة:\n\n' || reply ||
        E'\n\n✓ سُجّل غيابها اليوم (اختيارها يعدّل التسجيل)\nاختصار في رسالة واحدة: «غياب 3 أحمد، يوسف» أو «غياب 3 0»');
    end if;
    msg := rest;
    st.step := 'class';
    st.phone := pk;
  end if;

  if st.phone is null then return jsonb_build_object('reply', '', 'note', 'not in a conversation: send «غياب» first', 'teacher', who); end if;

  -- choosing the class: «3», or «3 أحمد، يوسف» to choose it and send the absentees at once
  if st.step = 'class' then
    cnum := substring(msg from '^([0-9]+)');
    if cnum is null then return jsonb_build_object('reply', 'أرسل رقم الشعبة (مثل 3)، أو «إلغاء».'); end if;
    select c.class_name into cls from att_classes() c where c.pos = cnum::int;
    if cls is null then return jsonb_build_object('reply', 'لا توجد شعبة بالرقم ' || cnum || '. أرسل «غياب» لعرض الشعب.'); end if;
    rest := btrim(regexp_replace(substring(msg from '^[0-9]+(.*)$'), '^[ :\-]+', ''));
    update attendance_bot_state set step = 'absent', class_name = cls, updated_at = now() where phone = pk;
    if rest = '' then return jsonb_build_object('reply', att_bot_prompt(cls)); end if;
    return jsonb_build_object('reply', att_bot_absent(pk, cls, rest, who));
  end if;

  if st.step = 'absent' then
    if msg in ('قائمه', 'القائمه', 'الاسماء', 'اسماء') then
      select string_agg(r.pos || ') ' || r.full_name, E'\n' order by r.pos) into reply from att_roll(st.class_name) r;
      update attendance_bot_state set updated_at = now() where phone = pk;
      return jsonb_build_object('reply', 'طلاب ' || st.class_name || E':\n\n' || coalesce(reply, '—') ||
        E'\n\nأرسل أرقام الغائبين أو أسماءهم، أو 0 إن لم يغب أحد.');
    end if;
    return jsonb_build_object('reply', att_bot_absent(pk, st.class_name, msg, who));
  end if;

  return jsonb_build_object('reply', '');
end $$;

revoke all on function public.att_today(), public.att_phone(text), public.att_classes(), public.att_roll(text), public.att_save(text, uuid[], text),
  public.att_token_name(text), public.att_bot_ok(text), public.att_norm(text), public.att_name_hits(text, text), public.att_pick(text, text),
  public.att_bot_prompt(text), public.att_bot_absent(text, text, text, text) from public, anon, authenticated;
grant execute on function public.absence_classes(text), public.absence_roll(text, text), public.absence_submit(text, text, uuid[]),
  public.absence_links(text), public.absence_missing(text), public.absence_bot(text, text, text) to anon, authenticated;



-- ================================================================
-- paper_files.sql
-- ================================================================
-- أوراق العمل والاختبارات المنشورة من واتساب («نشر»)، وجمع صفحات التنسيق المصوّرة.
-- المعلم يرسل ملفه المصحَّح (Word أو PDF) إلى البوت مع كلمة «نشر» (اختياري: «نشر 30» لعدد النسخ، «نشر اختبار»، «نشر السادس»):
--   1) يُحفظ الملف هنا باسم المعلم والمادة والصف والفصل الدراسي، ويظهر في «أوراق العمل والاختبارات» في الموقع.
--   2) يُرسل فورًا إلى مجموعة الطباعة في واتساب.
--   3) ورقة العمل وحدها تُرسل إلى المشرف التربوي للاعتماد (رد «اعتماد» أو «رفض السبب»، أو من الموقع)،
--      وبعد اعتمادها تظهر لأولياء أمور طلاب ذلك الصف في صفحتهم، مصنَّفة حسب الفصل الدراسي. الاختبارات لا تظهر لأولياء الأمور أبدًا.
-- مجموعة الطباعة: يكتب المدير العام أو المشرف التربوي «مجموعة الطباعة» داخل المجموعة مرة واحدة (والبوت عضو فيها)، فيحفظها البوت.
-- شغّل هذا الملف مرة في محرر SQL في Supabase.

create table if not exists public.paper_files (
  id uuid primary key default gen_random_uuid(),
  no serial,
  teacher_id uuid references public.teachers (id) on delete set null,
  teacher_name text not null default '',
  phone text not null default '',
  kind text not null default 'ورقة عمل' check (kind in ('ورقة عمل', 'اختبار')),
  subject text not null default '',
  grade text not null default '',             -- الصف بالكلمة: الأول ... العاشر
  term text not null default '',              -- الفصل الدراسي الأول / الثاني
  file_name text not null default '',
  mime text not null default '',
  data text not null default '',              -- الملف نفسه (base64)
  size int not null default 0,
  copies int,
  printed_sent boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'none')),  -- none: اختبار لا يحتاج اعتمادًا
  review_note text not null default '',
  reviewed_by text not null default '',
  reviewed_at timestamptz,
  review_msgs text[] not null default '{}',  -- معرّفات رسائل الاعتماد التي أُرسلت للمشرفين (للرد عليها)
  created_at timestamptz not null default now()
);
create index if not exists paper_files_grade_idx on public.paper_files (grade, status);

-- إعدادات البوت (مجموعة الطباعة)
create table if not exists public.bot_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

-- صفحات التنسيق المصوّرة: تُجمع هنا (لا في ذاكرة n8n) لأن الصور تصل في رسائل متتالية تُعالج متزامنة
create table if not exists public.fmt_sessions (
  phone text primary key,
  msg_ids text[] not null default '{}',
  hint text not null default '',
  pdf boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.paper_files enable row level security;
alter table public.bot_settings enable row level security;
alter table public.fmt_sessions enable row level security;
revoke all on public.paper_files, public.bot_settings, public.fmt_sessions from anon;
revoke all on public.bot_settings, public.fmt_sessions from authenticated;
grant select, update, delete on public.paper_files to authenticated;
drop policy if exists paper_files_read on public.paper_files;
create policy paper_files_read on public.paper_files for select to authenticated
  using (public.my_role() in ('superadmin', 'manager', 'supervisor') or teacher_id = public.my_teacher_id());
drop policy if exists paper_files_review on public.paper_files;
create policy paper_files_review on public.paper_files for update to authenticated
  using (public.my_role() in ('superadmin', 'supervisor')) with check (public.my_role() in ('superadmin', 'supervisor'));
drop policy if exists paper_files_delete on public.paper_files;
create policy paper_files_delete on public.paper_files for delete to authenticated
  using (public.my_role() = 'superadmin' or (teacher_id = public.my_teacher_id() and status <> 'approved'));

-- المعلم صاحب الرقم (آخر ٩ أرقام)
create or replace function public.bot_teacher_of(p_phone text) returns public.teachers
language sql stable security definer set search_path = public as $$
  select t.* from teachers t
  where length(att_phone(p_phone)) >= 9 and t.phone <> '' and right(att_phone(t.phone), 9) = right(att_phone(p_phone), 9)
  order by (t.user_id is not null) desc limit 1
$$;

-- أرقام المعتمدين: المشرفون التربويون (وإن لم يوجد مشرف برقم: المدير العام)
create or replace function public.bot_reviewers() returns table (phone text, name text)
language sql stable security definer set search_path = public as $$
  with r as (
    select distinct att_phone(t.phone) as phone, t.name, p.role from profiles p
    join teachers t on (t.id = p.teacher_id or t.user_id = p.id)
    where p.role in ('supervisor', 'superadmin') and t.phone <> ''
  )
  select phone, name from r where role = 'supervisor'
  union all
  select phone, name from r where role = 'superadmin' and not exists (select 1 from r where role = 'supervisor')
$$;

-- هل هذا الرقم معتمِد؟
create or replace function public.bot_is_reviewer(p_phone text) returns text
language sql stable security definer set search_path = public as $$
  select name from public.bot_reviewers() where right(phone, 9) = right(att_phone(p_phone), 9) limit 1
$$;

-- «نشر»: حفظ الملف. يعيد رقم الورقة، والمعلم، ومجموعة الطباعة، وأرقام المعتمدين (لورقة العمل)
create or replace function public.bot_paper_publish(p_key text, p_phone text, p_kind text, p_subject text, p_grade text, p_term text,
  p_file_name text, p_mime text, p_data text, p_copies int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t teachers; f paper_files;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  t := public.bot_teacher_of(p_phone);
  if t.id is null then return jsonb_build_object('ok', false, 'reply', 'رقمك غير مسجَّل في بيانات المعلمين، فلا يمكن نشر الملف. تواصل مع الإدارة لإضافة رقمك.'); end if;
  if coalesce(p_kind, '') not in ('ورقة عمل', 'اختبار') then return jsonb_build_object('ok', false, 'reply', 'اكتب نوع الملف مع كلمة النشر: «نشر ورقة عمل» أو «نشر اختبار».'); end if;
  if length(coalesce(p_data, '')) < 100 then return jsonb_build_object('ok', false, 'reply', 'تعذر استلام الملف. أرسله مرة أخرى.'); end if;
  insert into paper_files (teacher_id, teacher_name, phone, kind, subject, grade, term, file_name, mime, data, size, copies, status)
  values (t.id, t.name, att_phone(p_phone), p_kind, coalesce(p_subject, ''), coalesce(p_grade, ''), coalesce(p_term, ''), coalesce(p_file_name, ''), coalesce(p_mime, ''),
          p_data, (length(p_data) * 3 / 4)::int, p_copies, case when p_kind = 'اختبار' then 'none' else 'pending' end)
  returning * into f;
  return jsonb_build_object('ok', true, 'id', f.id, 'no', f.no, 'teacher', t.name,
    'print_group', (select value from bot_settings where key = 'print_group'),
    'reviewers', case when f.status = 'pending' then (select coalesce(jsonb_agg(jsonb_build_object('phone', phone, 'name', name)), '[]'::jsonb) from public.bot_reviewers()) else '[]'::jsonb end);
end $$;

-- بعد إرسال الملف: هل وصل لمجموعة الطباعة، ومعرّفات رسائل الاعتماد
create or replace function public.bot_paper_sent(p_key text, p_id uuid, p_printed boolean, p_msgs text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  update paper_files set printed_sent = coalesce(p_printed, printed_sent), review_msgs = review_msgs || coalesce(p_msgs, '{}') where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- رد المشرف: «اعتماد» أو «رفض السبب»، ردًا على رسالة الورقة (p_ref) أو برقمها («اعتماد 12»)
create or replace function public.bot_paper_review(p_key text, p_phone text, p_ref text, p_no int, p_approve boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text; f paper_files;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  who := public.bot_is_reviewer(p_phone);
  if who is null then return jsonb_build_object('ok', false, 'silent', true, 'note', 'not a reviewer'); end if;
  if coalesce(p_ref, '') <> '' then select * into f from paper_files where p_ref = any (review_msgs) limit 1; end if;
  if f.id is null and p_no is not null then select * into f from paper_files where no = p_no; end if;
  if f.id is null then
    select * into f from paper_files where status = 'pending' order by created_at desc limit 1;
    if f.id is null or (select count(*) from paper_files where status = 'pending') > 1 then
      return jsonb_build_object('ok', false, 'reply', 'لم أعرف أي ورقة تقصد. رُدّ على رسالة الورقة نفسها، أو اكتب رقمها: «اعتماد 12» أو «رفض 12 السبب».');
    end if;
  end if;
  if f.kind <> 'ورقة عمل' then return jsonb_build_object('ok', false, 'reply', 'الورقة رقم ' || f.no || ' اختبار، والاختبارات لا تُعرض على أولياء الأمور فلا تحتاج اعتمادًا.'); end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reply', 'اكتب سبب الرفض بعد الكلمة، مثل: «رفض ' || f.no || ' في السؤال الثاني خطأ إملائي».');
  end if;
  update paper_files set status = case when p_approve then 'approved' else 'rejected' end, review_note = coalesce(trim(p_reason), ''),
    reviewed_by = who, reviewed_at = now() where id = f.id;
  return jsonb_build_object('ok', true, 'no', f.no, 'teacher_phone', f.phone, 'approved', p_approve,
    'reply', case when p_approve then '✅ اعتُمدت ورقة العمل رقم ' || f.no || ' (' || f.teacher_name || ')، وظهرت لأولياء أمور ' || coalesce(nullif('الصف ' || f.grade, 'الصف '), 'الصف المحدد') || '.'
                  else 'تم رفض الورقة رقم ' || f.no || '، وأُبلغ المعلم بالسبب.' end,
    'teacher_text', case when p_approve then '✅ اعتُمدت ورقة العمل رقم ' || f.no || (case when f.subject <> '' then ' (' || f.subject || ')' else '' end) || ' ونُشرت لأولياء الأمور.'
                         else '↩️ لم تُعتمد ورقة العمل رقم ' || f.no || ' للنشر لأولياء الأمور.' || E'\nالسبب: ' || trim(p_reason) || E'\nصحّحها ثم أرسلها مرة أخرى مع كلمة «نشر».' end);
end $$;

-- «مجموعة الطباعة» تُكتب داخل المجموعة: يحفظها البوت إن كان الكاتب المدير العام أو مشرفًا تربويًا
create or replace function public.bot_set_print_group(p_key text, p_phone text, p_jid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  select exists (select 1 from profiles p join teachers t on (t.id = p.teacher_id or t.user_id = p.id)
                 where p.role in ('superadmin', 'supervisor') and t.phone <> '' and right(att_phone(t.phone), 9) = right(att_phone(p_phone), 9)) into ok;
  if not ok then return jsonb_build_object('ok', false, 'note', 'sender is not the system admin or a supervisor'); end if;
  if p_jid !~ '@g\.us$' then return jsonb_build_object('ok', false, 'note', 'not a group'); end if;
  insert into bot_settings (key, value, updated_at) values ('print_group', p_jid, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'reply', '✅ حُفظت هذه المجموعة مجموعةً للطباعة. ستصلها الأوراق التي ينشرها المعلمون.');
end $$;

-- صفحات التنسيق: إضافة صفحة (يعيد عددها)، وأخذها كلها للمعالجة
create or replace function public.bot_fmt_page(p_key text, p_phone text, p_msg_id text, p_hint text, p_pdf boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s fmt_sessions; ph text := right(att_phone(p_phone), 9);
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  insert into fmt_sessions (phone, msg_ids, hint, pdf, updated_at) values (ph, array[p_msg_id], coalesce(p_hint, ''), coalesce(p_pdf, false), now())
  on conflict (phone) do update set
    msg_ids = case when fmt_sessions.updated_at < now() - interval '30 minutes' then array[p_msg_id] when p_msg_id = any (fmt_sessions.msg_ids) then fmt_sessions.msg_ids else fmt_sessions.msg_ids || p_msg_id end,
    hint = coalesce(nullif(p_hint, ''), fmt_sessions.hint), pdf = fmt_sessions.pdf or coalesce(p_pdf, false), updated_at = now()
  returning * into s;
  return jsonb_build_object('n', cardinality(s.msg_ids));
end $$;

-- p_idle: ثوانٍ يجب أن تمضي بلا صفحة جديدة (0 = خذها الآن، عند «تم»)
create or replace function public.bot_fmt_take(p_key text, p_phone text, p_idle int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s fmt_sessions; ph text := right(att_phone(p_phone), 9);
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  delete from fmt_sessions where phone = ph and updated_at <= now() - make_interval(secs => greatest(coalesce(p_idle, 0), 0)) returning * into s;
  if s.phone is null then return jsonb_build_object('ids', '[]'::jsonb); end if;
  return jsonb_build_object('ids', to_jsonb(s.msg_ids), 'hint', s.hint, 'pdf', s.pdf);
end $$;

-- صفحة ولي الأمر: أوراق العمل المعتمدة لصفوف أبنائه (بلا الملف)، ثم الملف عند فتحه
create or replace function public.parent_papers(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select guardian_key into k from parent_links where token = p_token and active;
  if k is null then return jsonb_build_object('error', 'غير مسموح'); end if;
  return jsonb_build_object('papers', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'subject', f.subject, 'grade', f.grade, 'term', f.term,
      'teacher', f.teacher_name, 'name', f.file_name, 'mime', f.mime, 'at', f.created_at) order by f.term, f.created_at desc), '[]'::jsonb)
    from paper_files f
    where f.kind = 'ورقة عمل' and f.status = 'approved' and f.grade <> ''
      and exists (select 1 from students s where s.status in ('final', 'reserve') and public.parent_key(s.details, s.phone, s.id) = k
                  and s.class_name like '%' || f.grade || '%')));
end $$;
create or replace function public.parent_paper_file(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; f paper_files;
begin
  select guardian_key into k from parent_links where token = p_token and active;
  if k is null then return jsonb_build_object('error', 'غير مسموح'); end if;
  select * into f from paper_files where id = p_id and kind = 'ورقة عمل' and status = 'approved'
    and exists (select 1 from students s where s.status in ('final', 'reserve') and public.parent_key(s.details, s.phone, s.id) = k
                and s.class_name like '%' || paper_files.grade || '%');
  if f.id is null then return jsonb_build_object('error', 'غير متاح'); end if;
  return jsonb_build_object('name', f.file_name, 'mime', f.mime, 'data', f.data);
end $$;

revoke all on function public.bot_teacher_of(text), public.bot_reviewers(), public.bot_is_reviewer(text) from public, anon, authenticated;
grant execute on function public.bot_paper_publish(text, text, text, text, text, text, text, text, text, int), public.bot_paper_sent(text, uuid, boolean, text[]),
  public.bot_paper_review(text, text, text, int, boolean, text), public.bot_set_print_group(text, text, text),
  public.bot_fmt_page(text, text, text, text, boolean), public.bot_fmt_take(text, text, int) to anon, authenticated;
grant execute on function public.parent_papers(text), public.parent_paper_file(text, uuid) to anon, authenticated;



-- ================================================================
-- reserve_and_exempt.sql
-- ================================================================
-- 1) "Reserve" registration status (waiting list), beside preliminary and final.
-- 2) Transport fee exemption for a range of months, per student.
-- Run this file once in the Supabase SQL Editor. It does not change existing data.

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('pending', 'reserve', 'final'));

alter table public.transport_members
  add column if not exists exempt_from text check (exempt_from is null or exempt_from ~ '^\d{4}-\d{2}$'),  -- first exempt month ("2026-10")
  add column if not exists exempt_to text check (exempt_to is null or exempt_to ~ '^\d{4}-\d{2}$'),      -- last exempt month; null = until changed
  add column if not exists exempt_note text not null default '';



-- ================================================================
-- staff_bot.sql
-- ================================================================
-- كشف الدوام عبر واتساب: رقم مسموح يرسل «دوام» إلى رقم الأكاديمية، فيُطلب منه صورة كشف التوقيعات، تُقرأ
-- (خدمة read-staff-sheet)، ثم يؤكد تاريخ الكشف، فتُحفظ القراءة في «صندوق وارد» بانتظار مراجعتها وحفظها من شاشة «دوام الموظفين».
-- لا يُسجَّل أي دوام من هنا: الحفظ من الموقع فقط، بعد التدقيق.
-- الأرقام المسموحة تُدار من شاشة «دوام الموظفين» (المدير العام). n8n يتصل بمفتاح البوت نفسه (attendance_settings.bot_key).
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد attendance_links.sql و staff_attendance.sql). لا يغيّر أي بيانات موجودة.

create table if not exists public.staff_bot_phones (
  phone text primary key,                 -- أرقام فقط بصيغة الواتساب (att_phone)
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.staff_sheet_inbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  phone text not null default '',
  sender text not null default '',
  sheet_date date,                        -- التاريخ كما قُرئ من الكشف
  day date,                               -- التاريخ الذي أكّده المرسل
  rows jsonb not null default '[]'::jsonb, -- [{ teacher_id, name, in, out, status, note, unsure }]
  model text not null default '',
  status text not null default 'await_date' check (status in ('await_date', 'pending', 'applied', 'discarded')),
  done_at timestamptz,
  done_by text not null default ''
);
create index if not exists staff_sheet_inbox_status_idx on public.staff_sheet_inbox (status, day);

-- أين المرسل في المحادثة: بانتظار الصورة، أو بانتظار تأكيد التاريخ
create table if not exists public.staff_bot_state (
  phone text primary key,
  step text not null check (step in ('image', 'date')),
  inbox_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.staff_bot_phones enable row level security;
alter table public.staff_sheet_inbox enable row level security;
alter table public.staff_bot_state enable row level security;
revoke all on public.staff_bot_phones, public.staff_sheet_inbox, public.staff_bot_state from anon;
grant select, insert, update, delete on public.staff_bot_phones to authenticated;
grant select, update on public.staff_sheet_inbox to authenticated;

drop policy if exists staff_bot_phones_admin on public.staff_bot_phones;
create policy staff_bot_phones_admin on public.staff_bot_phones
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists staff_sheet_inbox_read on public.staff_sheet_inbox;
create policy staff_sheet_inbox_read on public.staff_sheet_inbox
  for select to authenticated using (public.my_role() in ('superadmin', 'manager'));
drop policy if exists staff_sheet_inbox_done on public.staff_sheet_inbox;
create policy staff_sheet_inbox_done on public.staff_sheet_inbox
  for update to authenticated using (public.my_role() in ('superadmin', 'manager')) with check (public.my_role() in ('superadmin', 'manager'));
-- staff_bot_state: بلا صلاحية؛ تمسه الدوال أدناه فقط

-- المرسل المسموح (بآخر 9 أرقام، فتتطابق صيغ الرقم المختلفة)
create or replace function public.staff_bot_sender(p_phone text) returns staff_bot_phones
language sql stable security definer set search_path = public as $$
  select * from staff_bot_phones where length(att_phone(p_phone)) >= 9 and right(phone, 9) = right(att_phone(p_phone), 9) limit 1
$$;

-- التاريخ من رد المرسل: 20/10/2026 أو 20/10 أو 2026-10-20 (بأرقام عربية أو غربية). null إن لم يكن تاريخًا صحيحًا
create or replace function public.staff_bot_date(p text) returns date
language plpgsql immutable as $$
declare t text := btrim(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')); m text[];
begin
  m := regexp_match(t, '^(\d{4})-(\d{1,2})-(\d{1,2})$');
  if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;
  m := regexp_match(t, '^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$');
  if m is null then return null; end if;
  return make_date(case when m[3] is null then extract(year from att_today())::int when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, m[2]::int, m[1]::int);
exception when others then return null;
end $$;

-- عدد الأسطر بالعربية: «سطر واحد»، «سطران»، «3 أسطر»، «11 سطرًا»
create or replace function public.staff_bot_lines(n int) returns text
language sql immutable as $$
  select case when n = 1 then 'سطر واحد' when n = 2 then 'سطران' when n between 3 and 10 then n || ' أسطر' else n || ' سطرًا' end
$$;

-- رسالة نصية من الواتساب. handled = false: الرسالة ليست لمحادثة الدوام، فتكمل إلى بوت الغياب
create or replace function public.staff_bot(p_key text, p_phone text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who staff_bot_phones;
  pk text := right(att_phone(p_phone), 9);
  msg text := att_norm(p_text);
  st staff_bot_state;
  ib staff_sheet_inbox;
  d date;
  n int; u int;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key: the n8n key does not match the one in the settings screen (الإعدادات والمستخدمون)'); end if;
  who := staff_bot_sender(p_phone);
  if who.phone is null then
    return jsonb_build_object('handled', false, 'note', 'الرقم +' || att_phone(p_phone) || ' ليس من الأرقام المسموحة في «دوام الموظفين»، فذهبت الرسالة إلى بوت الغياب');
  end if;
  select * into st from staff_bot_state where phone = pk and updated_at > now() - interval '30 minutes';

  if msg = 'دوام' then
    insert into staff_bot_state (phone, step, inbox_id, updated_at) values (pk, 'image', null, now())
      on conflict (phone) do update set step = 'image', inbox_id = null, updated_at = now();
    return jsonb_build_object('handled', true, 'reply', 'أرسل صورة كشف توقيعات الدوام (صورة واحدة واضحة للكشف كاملًا).' || E'\nللإلغاء أرسل «إلغاء».');
  end if;
  if st.phone is null then return jsonb_build_object('handled', false, 'note', 'لا محادثة دوام مفتوحة لهذا الرقم (تبدأ بكلمة «دوام»)، فذهبت الرسالة إلى بوت الغياب'); end if;

  if msg in ('الغاء', 'إلغاء') then
    if st.inbox_id is not null then update staff_sheet_inbox set status = 'discarded', done_at = now(), done_by = who.name where id = st.inbox_id and status = 'await_date'; end if;
    delete from staff_bot_state where phone = pk;
    return jsonb_build_object('handled', true, 'reply', 'أُلغي إرسال كشف الدوام.');
  end if;

  if st.step = 'image' then
    return jsonb_build_object('handled', true, 'reply', 'بانتظار صورة كشف الدوام. أرسلها صورةً (لا ملفًا)، أو «إلغاء».');
  end if;

  -- بانتظار تأكيد التاريخ
  select * into ib from staff_sheet_inbox where id = st.inbox_id;
  if ib.id is null then delete from staff_bot_state where phone = pk; return jsonb_build_object('handled', false, 'note', 'انتهت محادثة الدوام السابقة'); end if;
  if msg in ('1', 'نعم', 'تم', 'موافق', 'اه', 'أكيد', 'اكيد') then d := coalesce(ib.sheet_date, att_today());
  else d := staff_bot_date(msg); end if;
  if d is null then
    return jsonb_build_object('handled', true, 'reply', 'لم أفهم التاريخ. أرسل «1» لتأكيد ' || to_char(coalesce(ib.sheet_date, att_today()), 'DD/MM/YYYY') ||
      '، أو اكتب التاريخ الصحيح مثل ' || to_char(att_today(), 'DD/MM/YYYY') || '، أو «إلغاء».');
  end if;
  if d > att_today() or d < att_today() - 60 then
    return jsonb_build_object('handled', true, 'reply', 'التاريخ ' || to_char(d, 'DD/MM/YYYY') || ' غير مقبول (في المستقبل أو أقدم من شهرين). اكتب التاريخ الصحيح، أو «إلغاء».');
  end if;
  update staff_sheet_inbox set day = d, status = 'pending' where id = ib.id;
  delete from staff_bot_state where phone = pk;
  n := jsonb_array_length(ib.rows);
  select count(*) into u from jsonb_array_elements(ib.rows) r where coalesce(r ->> 'teacher_id', '') = '';
  return jsonb_build_object('handled', true, 'reply',
    'تم ✓ قراءة كشف يوم ' || to_char(d, 'DD/MM/YYYY') || ' (' || staff_bot_lines(n) || case when u > 0 then '، منها ' || staff_bot_lines(u) || ' لم يُعرف صاحبه' else '' end || ') ' ||
    'بانتظار مراجعتك في الموقع: «دوام الموظفين» ← «قراءات واردة من واتساب».' || E'\nلا يُسجَّل شيء قبل أن تراجعها وتضغط «حفظ».' ||
    E'\nhttps://ahmedhmmad.github.io/evaluation/#/staffatt');
end $$;

-- تسأل عنها خدمة القراءة قبل قراءة صورة: هل المرسل مسموح وبانتظار صورة؟ وتعيد قائمة العاملين للمطابقة
create or replace function public.staff_bot_image(p_key text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare who staff_bot_phones;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key: the n8n key does not match the one in the settings screen (الإعدادات والمستخدمون)'); end if;
  who := staff_bot_sender(p_phone);
  -- تُتجاهل الصورة بصمت إلا من رقم مسموح بدأ محادثة الدوام بكلمة «دوام» (فلا يُرد على الصور العادية)
  if who.phone is null then
    return jsonb_build_object('ok', false, 'allowed', false, 'note', 'الرقم +' || att_phone(p_phone) || ' ليس من الأرقام المسموحة في «دوام الموظفين»؛ تُتجاهل صورته');
  end if;
  if not exists (select 1 from staff_bot_state where phone = right(att_phone(p_phone), 9) and step = 'image' and updated_at > now() - interval '30 minutes') then
    return jsonb_build_object('ok', false, 'allowed', false, 'note', 'صورة خارج محادثة الدوام (لم تبدأ بكلمة «دوام»)؛ تُتجاهل بصمت');
  end if;
  return jsonb_build_object('ok', true, 'staff', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'title', coalesce(nullif(to_jsonb(t) ->> 'job_title', ''), to_jsonb(t) ->> 'category', '')) order by t.name)
    from teachers t where coalesce((to_jsonb(t) ->> 'contract_end')::date, att_today()) >= att_today() - 60), '[]'::jsonb));
end $$;

-- تحفظ خدمة القراءة ما قرأته، وتعيد رد السؤال عن التاريخ
create or replace function public.staff_bot_store(p_key text, p_phone text, p_rows jsonb, p_date date, p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who staff_bot_phones; pk text := right(att_phone(p_phone), 9); nid uuid; n int; u int; d date := coalesce(p_date, att_today());
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key'); end if;
  who := staff_bot_sender(p_phone);
  if who.phone is null then return jsonb_build_object('error', 'sender not allowed'); end if;
  insert into staff_sheet_inbox (phone, sender, sheet_date, rows, model, status)
  values (pk, who.name, p_date, coalesce(p_rows, '[]'::jsonb), coalesce(p_model, ''), 'await_date') returning id into nid;
  insert into staff_bot_state (phone, step, inbox_id, updated_at) values (pk, 'date', nid, now())
    on conflict (phone) do update set step = 'date', inbox_id = nid, updated_at = now();
  n := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  select count(*) into u from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r where coalesce(r ->> 'teacher_id', '') = '';
  if n = 0 then
    delete from staff_bot_state where phone = pk;
    update staff_sheet_inbox set status = 'discarded', done_at = now(), done_by = 'لا أسطر' where id = nid;
    return jsonb_build_object('reply', 'لم أجد في الصورة كشف دوام مقروءًا. أرسل «دوام» ثم صورة أوضح للكشف كاملًا.');
  end if;
  return jsonb_build_object('reply', 'قُرئ الكشف: ' || staff_bot_lines(n) || case when u > 0 then ' (لم يُعرف صاحب ' || staff_bot_lines(u) || ')' else '' end || '.' ||
    case when p_date is not null then E'\nالتاريخ المكتوب على الكشف: ' || to_char(p_date, 'DD/MM/YYYY') else E'\nلم أجد تاريخًا مكتوبًا على الكشف.' end ||
    E'\nأرسل «1» إن كان كشف يوم ' || to_char(d, 'DD/MM/YYYY') || '، أو اكتب التاريخ الصحيح مثل ' || to_char(att_today(), 'DD/MM/YYYY') || '، أو «إلغاء».');
end $$;

revoke all on function public.staff_bot_sender(text), public.staff_bot_date(text), public.staff_bot_lines(int) from public, anon, authenticated;
revoke all on function public.staff_bot(text, text, text), public.staff_bot_image(text, text), public.staff_bot_store(text, text, jsonb, date, text) from public;
grant execute on function public.staff_bot(text, text, text), public.staff_bot_image(text, text), public.staff_bot_store(text, text, jsonb, date, text) to anon, authenticated;

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.staff_bot_phones;
    create trigger audit_row after insert or update or delete on public.staff_bot_phones for each row execute function public.audit_row('phone');
  end if;
end $$;



-- ================================================================
-- student_dropout.sql
-- ================================================================
-- «منقطع»: حالة تسجيل جديدة بجانب المبدئي والاحتياط والنهائي.
-- المنقطع يخرج من كشوف الحضور والباصات وعدد الشعبة (كل ما يعدّ الطلاب يأخذ النهائي والاحتياط فقط).
-- لا ينقله إلى «منقطع» ولا يعيده منها إلا المدير العام، ولا يعود إلا بعد توقيع ولي الأمر إقرار الالتزام:
-- عند الإعادة يُسجَّل في details.dropout_log سطر فيه back_at و pledge = true، وإلا رُفض الحفظ.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر بيانات موجودة.

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('pending', 'reserve', 'final', 'dropped'));

create or replace function public.students_dropout_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare was boolean := false;
        now_d boolean := new.status = 'dropped';
        last jsonb;
begin
  if tg_op = 'UPDATE' then was := old.status = 'dropped'; end if;
  if was = now_d then return new; end if;
  -- محرر SQL (بلا مستخدم) مسموح له؛ ومن الموقع: المدير العام فقط
  if auth.uid() is not null and coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'نقل الطالب إلى «منقطع» أو إعادته منها للمدير العام فقط';
  end if;
  if was and not now_d and auth.uid() is not null then
    last := new.details -> 'dropout_log' -> -1;
    if last is null or coalesce(last ->> 'pledge', '') <> 'true' or coalesce(last ->> 'back_at', '') = '' then
      raise exception 'لا يعود الطالب المنقطع إلا بعد توقيع ولي الأمر إقرار الالتزام';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists students_dropout_guard on public.students;
create trigger students_dropout_guard before insert or update of status on public.students
  for each row execute function public.students_dropout_guard();



-- ================================================================
-- attendance_clerk.sql
-- ================================================================
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

-- النسخة المعتمدة من api_att_classes في api.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_classes' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_classes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('teacher', public.api_att_who(), 'day', att_today(), 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.class_name, 'students', c.students,
      'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name)) order by c.pos)
    from att_classes() c), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

-- النسخة المعتمدة من api_att_roll في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_roll' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

-- النسخة المعتمدة من api_att_submit في api.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_submit' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_submit(p_class text, p_absent uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  if not exists (select 1 from att_classes() c where c.class_name = p_class) then raise exception 'الشعبة غير موجودة'; end if;
  n := att_save(p_class, p_absent, public.api_att_who());
  return jsonb_build_object('saved', n, 'absent', coalesce((
    select jsonb_agg(r.full_name order by r.pos) from att_roll(p_class) r where r.id = any (coalesce(p_absent, '{}'))), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

revoke execute on function public.create_user_account(text, text, text, text) from public, anon;
grant execute on function public.create_user_account(text, text, text, text) to authenticated;
grant execute on function public.api_att_classes(), public.api_att_roll(text), public.api_att_submit(text, uuid[]) to authenticated;



-- ================================================================
-- auto_backup.sql
-- ================================================================
-- النسخ الاحتياطي التلقائي: n8n يطلب كل ليلة نسخة كاملة من القاعدة ويحفظها في Google Drive (n8n/auto-backup.json).
-- النسخة بنفس صيغة ملف «تنزيل نسخة احتياطية» في البرنامج، فتُستعاد من الشاشة نفسها.
-- الطلب يحتاج مفتاح النسخ (غير مفتاح بوت الغياب)؛ يراه المدير العام وحده في «الإعدادات والمستخدمون» ليضعه في n8n.
-- لا تدخل النسخة الأسرار: كلمة المرور الافتراضية، روابط الغياب السرية، مفتاح البوت، ولا سجل التعديلات.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.backup_status (
  id int primary key default 1 check (id = 1),
  backup_key text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_at timestamptz,          -- آخر نسخة حُفظت فعلًا في Drive
  last_file text not null default '',
  last_rows int not null default 0
);
insert into public.backup_status (id) values (1) on conflict (id) do nothing;

alter table public.backup_status enable row level security;
revoke all on public.backup_status from anon;
grant select on public.backup_status to authenticated;
drop policy if exists backup_status_admin on public.backup_status;
create policy backup_status_admin on public.backup_status
  for select to authenticated using (public.my_role() = 'superadmin');

-- النسخة كاملة. الجداول بنفس الترتيب والأسماء التي يستعيدها البرنامج (BACKUP_TABLES في index.html)
create or replace function public.backup_dump(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t text;
  rows jsonb;
  tables jsonb := '{}'::jsonb;
  cfg jsonb;
begin
  if p_key is null or p_key <> (select backup_key from backup_status where id = 1) then
    raise exception 'مفتاح النسخ غير صحيح';
  end if;
  foreach t in array array['teachers', 'visits', 'statements', 'students', 'transport_groups', 'transport_members', 'transport_payments',
      'transport_voided', 'transport_refunds', 'transport_topups', 'transport_staff_members', 'transport_staff_payments', 'transport_staff_refunds',
      'attendance', 'timetable_config', 'timetable_sessions', 'timetable_proposals', 'teacher_absences', 'substitutions',
      'staff_hours', 'staff_attendance'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    tables := tables || jsonb_build_object(t, rows);
  end loop;
  select to_jsonb(s) into cfg from settings s where id = 1;
  return jsonb_build_object('app', 'third-pillar-backup', 'version', 1, 'auto', true, 'created_at', now(),
    'school', coalesce(nullif(cfg ->> 'school_name', ''), 'أكاديمية الركيزة الثالثة'), 'settings', cfg, 'tables', tables);
end $$;

-- يستدعيها n8n بعد حفظ الملف في Drive، فيظهر في البرنامج وقت آخر نسخة ناجحة
create or replace function public.backup_done(p_key text, p_file text, p_rows int default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or p_key <> (select backup_key from backup_status where id = 1) then
    raise exception 'مفتاح النسخ غير صحيح';
  end if;
  update backup_status set last_at = now(), last_file = coalesce(p_file, ''), last_rows = coalesce(p_rows, 0) where id = 1;
end $$;

-- المدير العام يولّد مفتاحًا جديدًا إن تسرّب القديم (ثم يضعه في n8n)
create or replace function public.backup_new_key() returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'للمدير العام فقط'; end if;
  update backup_status set backup_key = k where id = 1;
  return k;
end $$;

revoke all on function public.backup_dump(text), public.backup_done(text, text, int), public.backup_new_key() from public;
grant execute on function public.backup_dump(text), public.backup_done(text, text, int) to anon, authenticated;
grant execute on function public.backup_new_key() to authenticated;



-- ================================================================
-- manager.sql
-- ================================================================
-- "Manager" role: sees every screen and every record, and changes nothing.
-- Read-only policies on each table; no insert/update/delete policy is given to this role, so the database
-- refuses any change it sends. Teacher absence links and their bot key stay with the superadmin only.
-- Run this file once in the Supabase SQL Editor, after the other scripts. It does not change existing data.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin'));

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'settings', 'teachers', 'visits', 'statements', 'students',
    'transport_groups', 'transport_members', 'transport_payments', 'transport_voided', 'transport_refunds', 'attendance']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_manager_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = ''manager'')', t || '_manager_read', t);
    end if;
  end loop;
end $$;



-- ================================================================
-- payroll.sql
-- ================================================================
-- الرواتب: «إعدادات الرواتب» و«حساب الرواتب».
--   payroll_setup: راتب كل موظف (من «بيانات العاملين») وقواعد الدوام، شهرًا بشهر. الشهر الذي لم تُحفظ له إعدادات
--                  يعتمد آخر شهر قبله حُفظت إعداداته (يُحسب ذلك في الصفحة).
--   payroll_runs:  الإضافات والخصومات اليدوية لكل شهر، وكشف الشهر كما اعتُمد (لا يتغير بعد الاعتماد بتعديل الدوام أو الرواتب).
--   payroll_access: من يصل إلى الرواتب غير المدير العام (حسابات المدير والمشرف العام): مشاهدة، أو تعديل.
-- المدير العام يرى ويعدّل دائمًا، وهو وحده يمنح الصلاحيات ويلغي اعتماد شهر.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql و staff_attendance.sql)، ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات موجودة.

create table if not exists public.payroll_setup (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  salaries jsonb not null default '{}'::jsonb,   -- { "<teacher_id>": 15000, ... }
  rules jsonb not null default '{}'::jsonb,      -- أيام العمل، التأخير المسموح، الإجازات في فترة، طريقة خصم التأخير، دوام المحفظين
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  can_edit boolean not null default false,
  granted_by text not null default '',
  granted_at timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  adj jsonb not null default '{}'::jsonb,        -- { "<teacher_id>": { "add": 500, "addNote": "...", "ded": 200, "dedNote": "..." } }
  rows jsonb,                                    -- كشف الشهر عند الاعتماد
  rules jsonb,
  approved_by text not null default '',
  approved_at timestamptz,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

-- تغيير راتب موظف خلال الشهر (نصف نصاب ثم نصاب كامل من تاريخ): { "<teacher_id>": { "from": "2026-11-10", "amount": 15000 } }
alter table public.payroll_setup add column if not exists changes jsonb not null default '{}'::jsonb;

-- إظهار سليبات شهر معتمد للموظفين في «دوامي وراتبي»: ممنوع افتراضيًا، ويُظهرها من له تعديل الرواتب
-- (المدير العام، والمدير والمشرف العام إن مُنحوا التعديل) بالدالة set_payroll_slips أدناه
alter table public.payroll_runs add column if not exists show_slip boolean not null default false;

-- صلاحية الحساب الحالي في الرواتب: 'edit' أو 'view' أو ''.
-- حساب «جهة مشرفة» (read_only، من outside_accounts.sql) مشاهدة فقط حتى لو مُنح التعديل
create or replace function public.payroll_level() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  ro boolean := false;
begin
  if public.my_role() = 'superadmin' then return 'edit'; end if;
  if public.my_role() <> 'manager' then return ''; end if;   -- المدير والمشرف العام (دوره manager)؛ لا المشرف التربوي
  if not exists (select 1 from public.payroll_access a where a.user_id = auth.uid()) then return ''; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_only') then
    execute 'select coalesce((select read_only from public.profiles where id = auth.uid()), false)' into ro;
  end if;
  if not ro and exists (select 1 from public.payroll_access a where a.user_id = auth.uid() and a.can_edit) then return 'edit'; end if;
  return 'view';
end;
$$;
revoke all on function public.payroll_level() from public, anon;
grant execute on function public.payroll_level() to authenticated;

alter table public.payroll_setup enable row level security;
alter table public.payroll_access enable row level security;
alter table public.payroll_runs enable row level security;
revoke all on public.payroll_setup, public.payroll_access, public.payroll_runs from anon;
grant select, insert, update, delete on public.payroll_setup, public.payroll_access, public.payroll_runs to authenticated;

drop policy if exists payroll_setup_admin on public.payroll_setup;
drop policy if exists payroll_setup_read on public.payroll_setup;
create policy payroll_setup_read on public.payroll_setup
  for select to authenticated using (public.payroll_level() <> '');
drop policy if exists payroll_setup_write on public.payroll_setup;
create policy payroll_setup_write on public.payroll_setup
  for all to authenticated using (public.payroll_level() = 'edit') with check (public.payroll_level() = 'edit');

drop policy if exists payroll_runs_read on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs
  for select to authenticated using (public.payroll_level() <> '');
-- التعديل: لمن له التعديل، والشهر المعتمد لا يُعدَّل إلا بإلغاء اعتماده، وهذا للمدير العام وحده
drop policy if exists payroll_runs_insert on public.payroll_runs;
create policy payroll_runs_insert on public.payroll_runs
  for insert to authenticated with check (public.payroll_level() = 'edit');
drop policy if exists payroll_runs_update on public.payroll_runs;
create policy payroll_runs_update on public.payroll_runs
  for update to authenticated using (public.payroll_level() = 'edit' and (status = 'draft' or public.my_role() = 'superadmin'))
  with check (public.payroll_level() = 'edit');
drop policy if exists payroll_runs_delete on public.payroll_runs;
create policy payroll_runs_delete on public.payroll_runs
  for delete to authenticated using (public.my_role() = 'superadmin');

drop policy if exists payroll_access_read on public.payroll_access;
create policy payroll_access_read on public.payroll_access
  for select to authenticated using (user_id = auth.uid() or public.my_role() = 'superadmin');
drop policy if exists payroll_access_write on public.payroll_access;
create policy payroll_access_write on public.payroll_access
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

create or replace function public.set_payroll_slips(p_month text, p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.payroll_level() <> 'edit' then raise exception 'لا تملك صلاحية تعديل الرواتب'; end if;
  update public.payroll_runs set show_slip = coalesce(p_show, false) where month = p_month and status = 'approved';
  if not found then raise exception 'رواتب هذا الشهر غير معتمدة'; end if;
end;
$$;
revoke all on function public.set_payroll_slips(text, boolean) from public, anon;
grant execute on function public.set_payroll_slips(text, boolean) to authenticated;

-- «حساب الرواتب» يقرأ «دوام الموظفين» ووقته الرسمي (المدير والمشرف يقرآنه أصلًا؛ هذا لمن أُعطي الرواتب)
do $$
begin
  if to_regclass('public.staff_attendance') is not null then
    drop policy if exists staff_attendance_payroll_read on public.staff_attendance;
    create policy staff_attendance_payroll_read on public.staff_attendance
      for select to authenticated using (public.payroll_level() <> '');
    drop policy if exists staff_hours_payroll_read on public.staff_hours;
    create policy staff_hours_payroll_read on public.staff_hours
      for select to authenticated using (public.payroll_level() <> '');
  end if;
end $$;

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.payroll_setup;
    create trigger audit_row after insert or update or delete on public.payroll_setup for each row execute function public.audit_row('month');
    drop trigger if exists audit_row on public.payroll_runs;
    create trigger audit_row after insert or update or delete on public.payroll_runs for each row execute function public.audit_row('month');
    drop trigger if exists audit_row on public.payroll_access;
    create trigger audit_row after insert or update or delete on public.payroll_access for each row execute function public.audit_row('user_id');
  end if;
end $$;



-- ================================================================
-- registrar.sql
-- ================================================================
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
-- النسخة المعتمدة من create_user_account في attendance_clerk.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'create_user_account' and pronamespace = 'public'::regnamespace) then
    execute $fn$
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
$$
    $fn$;
  end if;
end $guard$;

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



-- ================================================================
-- registrar_transport.sql
-- ================================================================
-- المسجِّل في «المواصلات»: يرى الباصات ودفعات الطلاب وسجلها، ويضيف الطلاب إلى الباصات ويزيلهم، ويصدر الإيصالات
-- (الإيصال الأول والإيصالات المكمِّلة). لا يحذف إيصالًا ولا يلغيه ولا يسترد ولا يعفي ولا يعدّل الرسوم والدورات والباصات نفسها،
-- ولا يرى إيصالات الموظفين. حماية الإيصالات المسجَّلة (receipts_lock.sql) تبقى على الجميع: لا يُخفَّض إيصال ولا يُعدَّل رقمه.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد registrar.sql و transport.sql و transport_topups.sql و transport_refunds.sql)،
-- ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات.

drop policy if exists transport_payments_registrar_read on public.transport_payments;
create policy transport_payments_registrar_read on public.transport_payments
  for select to authenticated using (public.my_role() = 'registrar');
drop policy if exists transport_payments_registrar_insert on public.transport_payments;
create policy transport_payments_registrar_insert on public.transport_payments
  for insert to authenticated with check (public.my_role() = 'registrar');
drop policy if exists transport_payments_registrar_update on public.transport_payments;
create policy transport_payments_registrar_update on public.transport_payments
  for update to authenticated using (public.my_role() = 'registrar') with check (public.my_role() = 'registrar');

do $$
begin
  if to_regclass('public.transport_topups') is not null then
    drop policy if exists transport_topups_registrar_read on public.transport_topups;
    create policy transport_topups_registrar_read on public.transport_topups
      for select to authenticated using (public.my_role() = 'registrar');
    drop policy if exists transport_topups_registrar_insert on public.transport_topups;
    create policy transport_topups_registrar_insert on public.transport_topups
      for insert to authenticated with check (public.my_role() = 'registrar');
  end if;
  -- المبالغ تُعرض صافية بعد الاسترداد، فيقرأ المسترَدّ (ولا يسجّله)
  if to_regclass('public.transport_refunds') is not null then
    drop policy if exists transport_refunds_registrar_read on public.transport_refunds;
    create policy transport_refunds_registrar_read on public.transport_refunds
      for select to authenticated using (public.my_role() = 'registrar');
  end if;
end $$;



-- ================================================================
-- staff_self.sql
-- ================================================================
-- «دوامي وراتبي»: كل حساب مربوط بسجل في «بيانات العاملين» يرى دوامه هو فقط، شهرًا بشهر (الحضور والغياب والإجازات والتأخير
-- بحسب مجموعة دوامه)، وسليب راتبه للشهر المعتمد إن أظهر المسؤول سليبات ذلك الشهر (ممنوعة افتراضيًا). لا يرى دوام غيره ولا رواتبهم.
-- الحساب مربوط بسجله إن كان profiles.teacher_id له، أو teachers.user_id يشير إليه.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff_attendance.sql، ويُفضّل بعد staff_shifts.sql و payroll.sql)، ويمكن تشغيله مرة أخرى.

create or replace function public.my_staff_month(p_month text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid;
  tname text;
  h jsonb;
  shift jsonb;
  g jsonb;
  days jsonb := '[]'::jsonb;
  slip jsonb;
  rules jsonb;
begin
  select coalesce(p.teacher_id, (select t.id from public.teachers t where t.user_id = auth.uid() limit 1)) into tid
    from public.profiles p where p.id = auth.uid();
  if tid is null then return null; end if;
  select name into tname from public.teachers where id = tid;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('id', tid, 'name', tname);
  end if;

  -- دوامه: مجموعته إن كانت له، وإلا الوقت الرسمي
  if to_regclass('public.staff_hours') is not null then
    select to_jsonb(x) into h from public.staff_hours x where x.id = 1;
  end if;
  shift := jsonb_build_object('name', 'الوقت الرسمي', 'time_in', left(coalesce(h->>'time_in', '07:30'), 5), 'time_out', left(coalesce(h->>'time_out', '13:30'), 5));
  if h ? 'assign' and (h->'assign') ? tid::text then
    for g in select * from jsonb_array_elements(coalesce(h->'groups', '[]'::jsonb)) loop
      if g->>'id' = h->'assign'->>tid::text then
        shift := jsonb_build_object('name', g->>'name', 'time_in', g->>'time_in', 'time_out', g->>'time_out');
      end if;
    end loop;
  end if;

  if to_regclass('public.staff_attendance') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'status', a.status, 'time_in', left(a.time_in::text, 5), 'time_out', left(a.time_out::text, 5), 'note', a.note) order by a.day), '[]'::jsonb)
      into days from public.staff_attendance a
     where a.teacher_id = tid and to_char(a.day, 'YYYY-MM') = p_month;
  end if;

  -- سليبه من كشف الشهر المعتمد، وفقط إن أُظهرت سليبات ذلك الشهر للموظفين (show_slip، ممنوعة افتراضيًا)
  if to_regclass('public.payroll_runs') is not null then
    execute 'select e, r.rules from public.payroll_runs r, jsonb_array_elements(coalesce(r.rows, ''[]''::jsonb)) e
              where r.month = $1 and r.status = ''approved'' and coalesce(r.show_slip, false) and e->>''id'' = $2 limit 1'
      into slip, rules using p_month, tid::text;
  end if;

  return jsonb_build_object('id', tid, 'name', tname, 'month', p_month, 'shift', shift, 'days', days, 'slip', slip,
    'rules', case when rules is null then null else jsonb_build_object('work_days', rules->'work_days', 'signer_title', rules->'signer_title', 'signer_name', rules->'signer_name') end);
end;
$$;
revoke all on function public.my_staff_month(text) from public, anon;
grant execute on function public.my_staff_month(text) to authenticated;



-- ================================================================
-- student_leaves.sql
-- ================================================================
-- إجازات الطلاب (عذر غياب لفترة، مثل عملية جراحية لأسبوع): من تاريخ إلى تاريخ، وسببها.
-- كل حضور يُسجَّل لطالب في أيام إجازته يُحفظ «مأذون» تلقائيًا، من أي مكان سُجِّل: الموقع، وتطبيق الموبايل، وروابط المعلمين، وبوت الغياب.
-- وعند إضافة إجازة تُحوَّل أيامها المسجَّلة من قبل إلى «مأذون». وفي الموبايل يظهر الطالب المجاز مُعلَّمًا من البداية.
-- يضيفها ويحذفها المدير العام والمسجِّل، ويراها كل من يرى الحضور. شغّل هذا الملف مرة في محرر SQL في Supabase، بعد attendance.sql و api.sql.
-- (إن أعدتَ تشغيل api.sql لاحقًا فأعد تشغيل هذا الملف بعده، لأنه يعدّل دالة api_att_roll)

create table if not exists public.student_leaves (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  from_day date not null,
  to_day date not null,
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists student_leaves_student_idx on public.student_leaves (student_id, from_day, to_day);

alter table public.student_leaves enable row level security;
revoke all on public.student_leaves from anon;
grant select, insert, update, delete on public.student_leaves to authenticated;

drop policy if exists student_leaves_edit on public.student_leaves;
create policy student_leaves_edit on public.student_leaves
  for all to authenticated
  using (public.my_role() in ('superadmin', 'registrar')) with check (public.my_role() in ('superadmin', 'registrar'));
drop policy if exists student_leaves_read on public.student_leaves;
create policy student_leaves_read on public.student_leaves
  for select to authenticated using (coalesce(public.my_role(), 'pending') <> 'pending');

-- الحضور في يوم إجازة يُحفظ «مأذون»، وملاحظته سبب الإجازة إن لم تُكتب ملاحظة
-- النسخة المعتمدة من attendance_apply_leave في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'attendance_apply_leave' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.attendance_apply_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select reason into l from student_leaves
  where student_id = new.student_id and new.day between from_day and to_day
  order by created_at desc limit 1;
  if found and new.status <> 'excused' then
    new.status := 'excused';
    if coalesce(new.note, '') = '' then new.note := 'إجازة' || case when l.reason <> '' then ': ' || l.reason else '' end; end if;
  end if;
  return new;
end $$
    $fn$;
  end if;
end $guard$;
drop trigger if exists attendance_apply_leave on public.attendance;
create trigger attendance_apply_leave before insert or update on public.attendance
  for each row execute function public.attendance_apply_leave();

-- عند إضافة إجازة أو تعديلها: أيامها المسجَّلة من قبل تصير «مأذون»
create or replace function public.student_leave_backfill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update attendance set status = 'excused', updated_at = now()
  where student_id = new.student_id and day between new.from_day and new.to_day and status <> 'excused';
  return new;
end $$;
drop trigger if exists student_leave_backfill on public.student_leaves;
create trigger student_leave_backfill after insert or update on public.student_leaves
  for each row execute function public.student_leave_backfill();

-- كشف الشعبة في تطبيق الموبايل: الطالب المجاز اليوم يظهر مُعلَّمًا (غائبًا بعذر) من البداية
-- النسخة المعتمدة من api_att_roll في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_roll' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))
             or exists (select 1 from student_leaves l where l.student_id = r.id and att_today() between l.from_day and l.to_day),
      'leave', (select l.reason from student_leaves l where l.student_id = r.id and att_today() between l.from_day and l.to_day order by l.created_at desc limit 1)) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

-- قالب رسالة الإجازة لولي الأمر: يُعدَّل من «رسائل واتساب» ← «القوالب».
-- {الاسم} {من} {إلى} {السبب} {التمني} {الأكاديمية} تُستبدل عند الإرسال (التمني بحسب نوع الإجازة: مرض، سفر…)
insert into public.wa_templates (key, title, body, sort) values
  ('leave', 'إجازة طالب', E'السلام عليكم ورحمة الله وبركاته،\nولي أمر الطالب/ة {الاسم} المحترم،\nنفيدكم بأنه تم تسجيل إجازة لابنكم/ابنتكم من {من} إلى {إلى} بسبب {السبب}، ولن يُحتسب غيابه/ا خلالها.\n{التمني}.\n{الأكاديمية}', 6)
on conflict (key) do nothing;



-- ================================================================
-- teacher_accounts.sql
-- ================================================================
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
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin'));

alter table public.profiles
  add column if not exists teacher_id uuid references public.teachers (id) on delete set null,
  add column if not exists must_change_password boolean not null default false;

-- ---------- School settings ----------

alter table public.settings
  add column if not exists principal_name text not null default 'أ. سمر أبو مدين',
  add column if not exists classes jsonb not null default '[]'::jsonb;   -- the school's classes and sections

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

-- النسخة المعتمدة من get_results في registrar.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'get_results' and pronamespace = 'public'::regnamespace) then
    execute $fn$
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
$$
    $fn$;
  end if;
end $guard$;



-- ================================================================
-- teacher_papers.sql
-- ================================================================
-- أوراق العمل والاختبارات: يُعدّها المعلم في الموقع (المحتوى فقط) وتُطبع بقالب الأكاديمية الرسمي.
-- كل معلم يرى أوراقه، ويختار نشر الورقة (public) فيراها زملاؤه، أو إبقاءها خاصة (private).
-- المدير العام والمدير والمشرف التربوي يرون كل الأوراق؛ والمشرف التربوي يعتمد أو يعيد للتعديل حين يُفعَّل الاعتماد.
-- وفيه أيضًا my_staff_cv(): السيرة الذاتية للمعلم نفسه في صفحة «دوامي وراتبي».
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد staff_self.sql، ويُفضّل بعد staff_cv.sql). لا يغيّر أي بيانات موجودة.

-- سجل العامل المربوط بالحساب الحالي (كما في my_staff_month)
create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p.teacher_id, (select t.id from teachers t where t.user_id = auth.uid() limit 1))
  from profiles p where p.id = auth.uid()
$$;
grant execute on function public.my_teacher_id() to authenticated;

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  kind text not null default 'worksheet' check (kind in ('worksheet', 'quiz', 'monthly', 'midterm', 'final')),
  subject text not null default '',
  class_name text not null default '',
  lesson text not null default '',          -- الدرس أو الوحدة
  term text not null default '',            -- الفصل الدراسي
  paper_date date,
  duration text not null default '',        -- زمن الاختبار
  instructions text not null default '',
  items jsonb not null default '[]',        -- [{title, points, body, lines}] الأنشطة أو الأسئلة بالترتيب
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists papers_teacher on public.papers (teacher_id, updated_at desc);

-- إعداد واحد: هل الاعتماد مفعَّل (معطَّل حتى يفعّله المدير العام)
create table if not exists public.paper_settings (
  id int primary key default 1 check (id = 1),
  review_enabled boolean not null default false
);
insert into public.paper_settings (id) values (1) on conflict (id) do nothing;

alter table public.papers enable row level security;
alter table public.paper_settings enable row level security;
revoke all on public.papers, public.paper_settings from anon;
grant select, insert, update, delete on public.papers to authenticated;
grant select, update on public.paper_settings to authenticated;

drop policy if exists papers_read on public.papers;
create policy papers_read on public.papers for select to authenticated using (
  teacher_id = public.my_teacher_id()
  or (visibility = 'public' and public.my_teacher_id() is not null)
  or public.my_role() in ('superadmin', 'manager', 'supervisor'));

-- المعلم يكتب أوراقه هو؛ والمدير العام كل الأوراق؛ والمشرف التربوي يعدّل حالة المراجعة (يمنع الـ trigger غير ذلك)
drop policy if exists papers_insert on public.papers;
create policy papers_insert on public.papers for insert to authenticated with check (
  (teacher_id = public.my_teacher_id() or public.my_role() = 'superadmin') and not coalesce(public.my_read_only(), false));
drop policy if exists papers_update on public.papers;
create policy papers_update on public.papers for update to authenticated
  using (teacher_id = public.my_teacher_id() or public.my_role() in ('superadmin', 'supervisor'))
  with check (not coalesce(public.my_read_only(), false));
drop policy if exists papers_delete on public.papers;
create policy papers_delete on public.papers for delete to authenticated using (
  (teacher_id = public.my_teacher_id() and status <> 'approved') or public.my_role() = 'superadmin');

drop policy if exists paper_settings_read on public.paper_settings;
create policy paper_settings_read on public.paper_settings for select to authenticated using (true);
drop policy if exists paper_settings_write on public.paper_settings;
create policy paper_settings_write on public.paper_settings for update to authenticated using (public.my_role() = 'superadmin');

-- الاعتماد والإعادة للمشرف التربوي والمدير العام فقط؛ والمعلم لا يعتمد ورقته. المشرف لا يغيّر محتوى ورقة غيره.
-- تعديل المعلم لورقة معتمدة أو معادة يعيدها مسودة.
create or replace function public.papers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare reviewer boolean := public.my_role() in ('superadmin', 'supervisor'); keep papers;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if not reviewer then new.status := case when new.status = 'submitted' then 'submitted' else 'draft' end; new.review_note := null; new.reviewed_by := null; new.reviewed_at := null; end if;
    return new;
  end if;
  if new.status in ('approved', 'returned') and new.status is distinct from old.status and not reviewer then
    raise exception 'الاعتماد للمشرف التربوي';
  end if;
  if public.my_role() = 'supervisor' and old.teacher_id is distinct from public.my_teacher_id() then
    -- المشرف على ورقة غيره: الحالة والملاحظة فقط
    keep := old;
    keep.status := new.status; keep.review_note := new.review_note; keep.reviewed_by := new.reviewed_by; keep.reviewed_at := new.reviewed_at; keep.updated_at := now();
    return keep;
  end if;
  if not reviewer and old.status in ('approved', 'returned') and (new.items is distinct from old.items or new.instructions is distinct from old.instructions) then
    new.status := 'draft';
  end if;
  return new;
end $$;
drop trigger if exists papers_guard on public.papers;
create trigger papers_guard before insert or update on public.papers for each row execute function public.papers_guard();

-- السيرة الذاتية للعامل نفسه: رابطها إن كان مفعّلًا، وبطاقة مؤهلاته المعتمدة
create or replace function public.my_staff_cv() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.my_teacher_id(); r jsonb;
begin
  if tid is null or to_regclass('public.staff_profiles') is null then return null; end if;
  select to_jsonb(p) into r from staff_profiles p where p.staff_id = tid and p.reviewed;
  if r is null then return null; end if;
  return jsonb_build_object('token', case when coalesce((r ->> 'cv_public')::boolean, false) then r ->> 'cv_token' end,
    'data', (r -> 'data') - 'unsure' - 'pages');
end $$;
grant execute on function public.my_staff_cv() to authenticated;

-- ورقة جاهزة: يرفع المعلم صورة أو PDF لورقة أعدّها من قبل، فتُطبع بترويسة الأكاديمية وتذييلها.
-- الملفات في Cloudflare R2 (دالة staff-files)، وهنا أسماؤها فقط.
alter table public.papers
  add column if not exists mode text not null default 'build',   -- build: محتوى يُكتب في الموقع؛ scan: صور أو PDF جاهزة
  add column if not exists files jsonb not null default '[]';     -- [{key, name, mime, size}]



-- ================================================================
-- transport_staff.sql
-- ================================================================
-- Transport for staff: a staff member (from the staff list, table teachers) can ride a bus and pay for it.
-- Kept apart from the students' tables, so nothing about students, their dues or their receipts changes.
-- A staff receipt takes its number from the same sequence as the students' receipts (one receipt book).
-- There is no fixed fee for staff: the amount is written on each receipt.
-- A receipt is never edited or deleted from the app; a mistaken one is voided (kept, marked, with the reason)
-- and a new one is issued. Written by the superadmin, read by the manager.
-- Run this file once in the Supabase SQL Editor, after transport.sql (and staff.sql, audit_log.sql if used).
-- It does not change existing data.

create table if not exists public.transport_staff_members (
  staff_id uuid primary key references public.teachers (id) on delete cascade,
  group_id uuid not null references public.transport_groups (id) on delete cascade,
  pickup text not null default '',
  left_from text check (left_from is null or left_from ~ '^\d{4}-\d{2}$'),   -- first cycle not riding; null = riding
  joined_at timestamptz not null default now()
);
create index if not exists transport_staff_members_group_idx on public.transport_staff_members (group_id);

create table if not exists public.transport_staff_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint not null,
  staff_id uuid not null references public.teachers (id) on delete restrict,
  staff_name text not null default '',          -- the name as printed on the receipt
  month text not null check (month ~ '^\d{4}-\d{2}$'),   -- the billing cycle (keyed by the month it starts in)
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  method_note text not null default '',
  paid_on date not null default current_date,
  issued_by text not null default '',
  issued_at timestamptz not null default now(),
  voided_at timestamptz,                         -- set once when the receipt is voided; it then counts nowhere
  voided_by text,
  void_reason text
);
create unique index if not exists transport_staff_payments_receipt_idx on public.transport_staff_payments (receipt_no);
create index if not exists transport_staff_payments_month_idx on public.transport_staff_payments (month, staff_id);
create index if not exists transport_staff_payments_paid_idx on public.transport_staff_payments (paid_on);

-- the same numbering as the students' receipts: one sequence, numbers never repeat
do $$
declare
  seq text := pg_get_serial_sequence('public.transport_payments', 'receipt_no');
begin
  execute format('alter table public.transport_staff_payments alter column receipt_no set default nextval(%L::regclass)', seq);
  execute format('grant usage, select on sequence %s to authenticated', seq);   -- Supabase grants this already; explicit for safety
end $$;

alter table public.transport_staff_members enable row level security;
alter table public.transport_staff_payments enable row level security;
revoke all on public.transport_staff_members, public.transport_staff_payments from anon;
grant select, insert, update, delete on public.transport_staff_members, public.transport_staff_payments to authenticated;

drop policy if exists transport_staff_members_admin on public.transport_staff_members;
create policy transport_staff_members_admin on public.transport_staff_members
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_members_manager_read on public.transport_staff_members;
create policy transport_staff_members_manager_read on public.transport_staff_members
  for select to authenticated using (public.my_role() = 'manager');

drop policy if exists transport_staff_payments_admin on public.transport_staff_payments;
create policy transport_staff_payments_admin on public.transport_staff_payments
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_payments_manager_read on public.transport_staff_payments;
create policy transport_staff_payments_manager_read on public.transport_staff_payments
  for select to authenticated using (public.my_role() = 'manager');

-- An issued staff receipt is never edited or deleted from the app: the only change allowed is voiding it once,
-- with a reason. Work done directly in the SQL Editor (as postgres) is not blocked, for supervised corrections.
create or replace function public.guard_transport_staff_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'لا يُحذف إيصال مسجَّل. ألغِه (يبقى محفوظًا بسبب الإلغاء) ثم أصدر إيصالًا جديدًا.';
  end if;
  -- UPDATE: voiding only
  if old.voided_at is not null then
    raise exception 'هذا الإيصال ملغى ولا يُعدَّل.';
  end if;
  if new.voided_at is null or coalesce(btrim(new.void_reason), '') = ''
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'لا يُعدَّل إيصال مسجَّل. ألغِه مع ذكر السبب ثم أصدر إيصالًا جديدًا.';
  end if;
  return new;
end $$;

drop trigger if exists guard_transport_staff_receipt on public.transport_staff_payments;
create trigger guard_transport_staff_receipt before update or delete on public.transport_staff_payments
  for each row execute function public.guard_transport_staff_receipt();

-- the change log (supabase/audit_log.sql), if it is installed
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.transport_staff_members;
    create trigger audit_row after insert or update or delete on public.transport_staff_members
      for each row execute function public.audit_row('staff_id');
    drop trigger if exists audit_row on public.transport_staff_payments;
    create trigger audit_row after insert or update or delete on public.transport_staff_payments
      for each row execute function public.audit_row('receipt_no');
  end if;
end $$;

-- ===== Refunds to staff =====
-- Money given back to a staff member from what they paid for a cycle. The receipt itself is never changed:
-- the refund is its own record (with a voucher number from the same book as the students' refunds when
-- transport_refunds.sql is installed), and the cycle's net is the receipts minus the refunds.
-- A refund is never edited or deleted from the app. Safe to re-run.
create table if not exists public.transport_staff_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no bigint,
  staff_id uuid not null references public.teachers (id) on delete restrict,
  staff_name text not null default '',
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  receipt_no bigint,                                   -- the latest receipt the money was paid with
  paid_before numeric not null default 0,              -- net paid for the cycle before this refund
  amount numeric not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'instapay', 'vodafone', 'other')),
  method_note text not null default '',
  reason text not null check (btrim(reason) <> ''),
  refunded_by text not null default '',
  refunded_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transport_staff_refunds_month_idx on public.transport_staff_refunds (month, staff_id);

do $$
declare
  seq text := case when to_regclass('public.transport_refunds') is not null
                   then pg_get_serial_sequence('public.transport_refunds', 'refund_no') end;
begin
  if seq is null then
    create sequence if not exists public.transport_staff_refunds_no_seq;
    seq := 'public.transport_staff_refunds_no_seq';
  end if;
  execute format('alter table public.transport_staff_refunds alter column refund_no set default nextval(%L::regclass)', seq);
  execute format('grant usage, select on sequence %s to authenticated', seq);
end $$;
create unique index if not exists transport_staff_refunds_no_idx on public.transport_staff_refunds (refund_no);

alter table public.transport_staff_refunds enable row level security;
revoke all on public.transport_staff_refunds from anon;
grant select, insert, update, delete on public.transport_staff_refunds to authenticated;
drop policy if exists transport_staff_refunds_admin on public.transport_staff_refunds;
create policy transport_staff_refunds_admin on public.transport_staff_refunds
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
drop policy if exists transport_staff_refunds_manager_read on public.transport_staff_refunds;
create policy transport_staff_refunds_manager_read on public.transport_staff_refunds
  for select to authenticated using (public.my_role() = 'manager');

-- net paid for a staff member's cycle: valid receipts minus refunds
create or replace function public.staff_transport_net(p_staff uuid, p_month text)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce((select sum(amount) from public.transport_staff_payments
                    where staff_id = p_staff and month = p_month and voided_at is null), 0)
       - coalesce((select sum(amount) from public.transport_staff_refunds
                    where staff_id = p_staff and month = p_month), 0)
$$;

-- a refund cannot exceed what is left of the cycle's payments, and is never edited or deleted
create or replace function public.guard_transport_staff_refund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('staff_refund:' || new.staff_id || ':' || new.month));
    if new.amount > public.staff_transport_net(new.staff_id, new.month) then
      raise exception 'المبلغ المسترد أكبر من صافي ما دفعه الموظف عن هذه الدورة.';
    end if;
    return new;
  end if;
  raise exception 'لا يُعدَّل سند استرداد مسجَّل ولا يُحذف.';
end $$;

drop trigger if exists guard_transport_staff_refund on public.transport_staff_refunds;
create trigger guard_transport_staff_refund before insert or update or delete on public.transport_staff_refunds
  for each row execute function public.guard_transport_staff_refund();

-- voiding a receipt must not leave the cycle refunded more than was paid
create or replace function public.guard_transport_staff_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and public.staff_transport_net(new.staff_id, new.month) < 0 then
    raise exception 'استُرد من هذه الدورة مبلغ لا يبقى له غطاء إن أُلغي هذا الإيصال.';
  end if;
  return new;
end $$;

drop trigger if exists guard_transport_staff_void on public.transport_staff_payments;
create trigger guard_transport_staff_void after update on public.transport_staff_payments
  for each row execute function public.guard_transport_staff_void();

do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.transport_staff_refunds;
    create trigger audit_row after insert or update or delete on public.transport_staff_refunds
      for each row execute function public.audit_row('refund_no');
  end if;
end $$;

-- ===== Exemption for staff =====
-- Like the students' exemption: a range of cycles (first and last start month; last empty = until changed)
-- in which the staff member rides without paying. Exempt cycles are never added to any money total. Safe to re-run.
alter table public.transport_staff_members
  add column if not exists exempt_from text check (exempt_from is null or exempt_from ~ '^\d{4}-\d{2}$'),
  add column if not exists exempt_to text check (exempt_to is null or exempt_to ~ '^\d{4}-\d{2}$'),
  add column if not exists exempt_note text not null default '';



-- ================================================================
-- api.sql
-- ================================================================
-- واجهة التطبيق (API): دوال يستدعيها تطبيق الموبايل (وأي برنامج آخر) بنفس حسابات الموقع وصلاحياته.
-- كل دالة تبدأ بـ api_، تعيد JSON، وتتحقق بنفسها من صلاحية صاحب الحساب. رسائل الخطأ بالعربية.
-- منطق الحساب هنا هو منطق الموقع نفسه (index.html)، منقولًا كما هو، فتتطابق الأرقام في الموقع والتطبيق.
-- التوثيق والأمثلة: docs/API.md
--
-- يحتاج إلى ملفات سابقة: students.sql, student_registration.sql, reserve_and_exempt.sql, transport*.sql, receipts_due.sql,
-- attendance.sql, attendance_links.sql, timetable.sql, timetable_plan.sql, substitutes.sql, parent_links.sql.
-- شغّل هذا الملف في محرر SQL في Supabase؛ ويمكن تشغيله مرة أخرى بعد أي تحديث له. لا يغيّر أي بيانات.

-- ===================================================================================================
-- مساعدات
-- ===================================================================================================

-- ترتيب الأسماء العربية كما يرتبها الموقع (localeCompare 'ar')
create collation if not exists public.api_ar (provider = icu, locale = 'ar');

-- يوقف الدالة إن لم يكن صاحب الحساب من الأدوار المذكورة
create or replace function public.api_need(variadic p_roles text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  if coalesce(public.my_role(), '') <> all (p_roles) then raise exception 'ليس لديك صلاحية لهذه العملية' using errcode = '42501'; end if;
end $$;

-- اليوم في مصر
create or replace function public.api_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- النص العربي بصيغة واحدة للبحث والمقارنة (مثل norm() في الموقع)
create or replace function public.api_norm(p text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(translate(regexp_replace(coalesce(p, ''), '[ً-ْـ*؟?:]', '', 'g'), 'أإآةى', 'اااهي'), '\s+', ' ', 'g')))
$$;

-- «الشهر» في المواصلات دورة: تُعرف بشهر بدايتها، ومواعيدها ورسومها من transport_cycle() (supabase/transport_cycles.sql)
drop function if exists public.api_fees();

-- آخر موعد لسداد اشتراك الدورة
create or replace function public.api_deadline(p_month text) returns date
language sql stable security definer set search_path = public as $$ select (public.transport_cycle(p_month) ->> 'due')::date $$;

-- ===================================================================================================
-- المواصلات: المطلوب من كل مشترك عن شهر (مثل payRows / dueRows في الموقع)
-- ===================================================================================================
-- المطالَب: من بدأ اشتراكه (صدر له إيصال عن الشهر أو قبله) ولم يُوقَف، أو المعفى المشترك، أو من له دفعة عن الشهر.
-- المطلوب: المحفوظ في إيصال الشهر إن صدر، وإلا المحدد له يدويًا، وإلا رسوم الأسرة: الأول من الإخوة المشتركين بمبلغ، ومن بعده بمبلغ أقل.
-- الإخوة: يجمعهم رقم هوية ولي الأمر أو الهاتف (آخر 10 أرقام) أو اسم الأب والجد والعائلة؛ والأول من بدأ اشتراكه أولًا (شهر أول دفعة) ثم الأكبر سنًّا ثم بالاسم.
-- الحالة: ok (لا متبقي)، grace (ضمن المهلة)، extended (مهلة إضافية)، late (متأخر)، suspended (موقوف عن الركوب).
create or replace function public.api_transport_dues(p_month text)
returns table (student_id uuid, group_id uuid, share numeric, paid numeric, left_amount numeric, exempt boolean, status text, state text, family_rank int, family_size int)
language plpgsql stable security definer set search_path = public as $$
declare
  fees jsonb := public.transport_cycle(p_month);   -- رسوم الدورة: الأول والإخوة
  today date := public.api_today();
begin
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'الشهر بصيغة YYYY-MM'; end if;
  return query
  with first_paid as (
    select p.student_id as sid, min(p.month) as m from transport_payments p where p.amount > 0 group by p.student_id
  ), pay as (
    select p.student_id as sid, p.amount, p.due from transport_payments p where p.month = p_month
  ), mem as (
    select m.student_id as sid, m.group_id as gid, m.share as mshare, m.left_from, m.exempt_from, m.exempt_to, m.grace_until, m.suspended_month,
           x.full_name, x.phone, x.details, to_jsonb(x) ->> 'birth_date' as birth, fp.m as first_m, py.amount as pamount, py.due as pdue,
           (m.exempt_from is not null and p_month >= m.exempt_from and (m.exempt_to is null or m.exempt_to = '' or p_month <= m.exempt_to)) as ex,
           (m.left_from is null or p_month < m.left_from) as subscribed
    from transport_members m
    join students x on x.id = m.student_id
    left join first_paid fp on fp.sid = m.student_id
    left join pay py on py.sid = m.student_id
  ), owing as (
    select * from mem
    where (ex and subscribed) or (first_m is not null and first_m <= p_month and subscribed) or coalesce(pamount, 0) > 0
  ), keys as (   -- مفاتيح الأخوّة
    select o.sid, 'g:' || btrim(o.details ->> 'guardian_id') as k from owing o where length(btrim(coalesce(o.details ->> 'guardian_id', ''))) >= 5
    union
    select o.sid, 'p:' || right(regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g'), 10) from owing o
      where length(regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g')) >= 8
    union
    select o.sid, 'n:' || f.fam from owing o
      cross join lateral (select array_to_string((regexp_split_to_array(public.api_norm(o.full_name), ' '))[2:], ' ') as fam) f
      where array_length(regexp_split_to_array(f.fam, ' '), 1) >= 3
  ), edges as (
    select a.sid as a, b.sid as b from keys a join keys b on a.k = b.k
  ), reach as (   -- كل من يصل إليه الطالب عبر مفاتيح مشتركة
    with recursive r(a, b) as (
      select o.sid, o.sid from owing o
      union
      select r.a, e.b from r join edges e on e.a = r.b
    ) select * from r
  ), fam as (
    select r.a as sid, min(r.b::text) as root from reach r group by r.a
  ), ranked as (
    select o.sid, f.root,
      row_number() over (partition by f.root order by coalesce(o.first_m, '9999'), coalesce(o.birth, '9999'), o.full_name collate public.api_ar) as rnk,
      count(*) over (partition by f.root) as size
    from owing o join fam f on f.sid = o.sid
  ), calc as (
    select o.*, g.id as group_ok, rk.rnk, rk.size,
      case when coalesce(o.pamount, 0) > 0 and o.pdue is not null then o.pdue
           when o.mshare is not null then o.mshare
           when rk.rnk > 1 then (fees ->> 'next')::numeric
           else (fees ->> 'first')::numeric end as sh
    from owing o join transport_groups g on g.id = o.gid join ranked rk on rk.sid = o.sid
  )
  select c.sid, c.gid, c.sh, coalesce(c.pamount, 0),
    case when c.ex then 0 else greatest(0, c.sh - coalesce(c.pamount, 0)) end,
    c.ex,
    case when c.ex then 'exempt' when c.sh > 0 and coalesce(c.pamount, 0) >= c.sh then 'paid' when coalesce(c.pamount, 0) > 0 then 'part' when c.sh > 0 then 'unpaid' else 'none' end,
    case when c.ex or greatest(0, c.sh - coalesce(c.pamount, 0)) <= 0 then 'ok'
         when c.suspended_month = p_month then 'suspended'
         when today <= public.api_deadline(p_month) then 'grace'
         when c.grace_until is not null and c.grace_until >= today then 'extended'
         else 'late' end,
    c.rnk::int, c.size::int
  from calc c;
end $$;

-- الإيصالات بين تاريخين (بتاريخ السداد): الأول بمبلغه الأول (قبل الإيصالات المكمِّلة)، والمكمِّل بمبلغه (مثل receiptsBetween في الموقع)
create or replace function public.api_receipt_rows(p_from date, p_to date)
returns table (receipt_no bigint, kind text, student_id uuid, month text, amount numeric, method text, ref text, issued_by text, paid_on date, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  with tops as (select * from transport_topups),
  first_top as (select distinct on (t.student_id, t.month) t.student_id, t.month, t.paid_before from tops t order by t.student_id, t.month, t.receipt_no)
  select p.receipt_no, 'main', p.student_id, p.month, coalesce(ft.paid_before, p.amount),
         case when p.method in ('cash', 'instapay', 'vodafone', 'other') then p.method else 'cash' end, coalesce(p.method_note, ''), coalesce(p.issued_by, ''), p.paid_on, p.issued_at
  from transport_payments p left join first_top ft on ft.student_id = p.student_id and ft.month = p.month
  where p.amount > 0 and p.paid_on between p_from and p_to
  union all
  select t.receipt_no, 'topup', t.student_id, t.month, t.amount,
         case when t.method in ('cash', 'instapay', 'vodafone', 'other') then t.method else 'cash' end, coalesce(t.method_note, ''), coalesce(t.issued_by, ''), t.paid_on, t.issued_at
  from tops t where t.paid_on between p_from and p_to
$$;

-- سجل الدفعات لفترة: الإيصالات، والمجاميع حسب وسيلة الدفع وحسب اليوم
create or replace function public.api_ledger(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('superadmin', 'manager');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'اختر فترة صحيحة'; end if;
  return (
    with r as (
      select r.*, x.full_name, x.class_name, g.assembly_point
      from public.api_receipt_rows(p_from, p_to) r
      left join students x on x.id = r.student_id
      left join transport_members m on m.student_id = r.student_id
      left join transport_groups g on g.id = m.group_id
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'total', coalesce((select sum(amount) from r), 0),
      'count', (select count(*) from r),
      'by_method', coalesce((select jsonb_object_agg(method, s) from (select method, sum(amount) as s from r group by method) q), '{}'::jsonb),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', paid_on, 'count', n, 'total', s, 'cash', c) order by paid_on)
                 from (select paid_on, count(*) as n, sum(amount) as s, coalesce(sum(amount) filter (where method = 'cash'), 0) as c from r group by paid_on) q), '[]'::jsonb),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('receipt_no', receipt_no, 'kind', kind, 'student_id', student_id, 'student', coalesce(full_name, '(طالب محذوف)'),
                    'class_name', coalesce(class_name, ''), 'bus', coalesce(assembly_point, ''), 'month', month, 'amount', amount, 'method', method, 'ref', ref,
                    'issued_by', issued_by, 'paid_on', paid_on, 'issued_at', issued_at) order by paid_on, receipt_no) from r), '[]'::jsonb))
  );
end $$;

-- المتأخرون في دفع المواصلات عن شهر (وكل من عليه متبقٍّ، بحالته)
create or replace function public.api_late_payers(p_month text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mon text := coalesce(nullif(p_month, ''), public.transport_current_cycle(public.api_today()));
begin
  perform public.api_need('superadmin', 'manager');
  return (
    with d as (
      select d.*, x.full_name, x.class_name, x.guardian_name, x.phone, x.whatsapp, g.assembly_point, m.grace_until
      from public.api_transport_dues(mon) d
      join students x on x.id = d.student_id join transport_groups g on g.id = d.group_id join transport_members m on m.student_id = d.student_id
      where d.left_amount > 0
    )
    select jsonb_build_object(
      'month', mon, 'cycle', public.transport_cycle(mon), 'deadline', public.api_deadline(mon),
      'days_late', greatest(0, public.api_today() - public.api_deadline(mon)),
      'counts', jsonb_build_object('late', (select count(*) from d where state = 'late'), 'extended', (select count(*) from d where state = 'extended'),
                                   'suspended', (select count(*) from d where state = 'suspended'), 'grace', (select count(*) from d where state = 'grace')),
      'owed', coalesce((select sum(left_amount) from d where state <> 'grace'), 0),
      'students', coalesce((select jsonb_agg(jsonb_build_object('student_id', student_id, 'name', full_name, 'class_name', class_name, 'bus', assembly_point,
                    'guardian', guardian_name, 'phone', phone, 'whatsapp', whatsapp, 'share', share, 'paid', paid, 'left', left_amount, 'state', state, 'grace_until', grace_until)
                    order by case state when 'late' then 0 when 'extended' then 1 when 'suspended' then 2 else 3 end, assembly_point, full_name) from d), '[]'::jsonb))
  );
end $$;

-- الغياب في يوم: لكل شعبة عدد طلابها، وهل سُجّل غيابها ومن سجّله، والغائبون
create or replace function public.api_attendance_day(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, public.api_today());
begin
  perform public.api_need('superadmin', 'manager', 'supervisor');
  return (
    with roll as (select x.class_name, count(*) as n from students x where x.status in ('final', 'reserve') and x.class_name <> '' group by x.class_name),
    att as (select a.*, x.full_name from attendance a left join students x on x.id = a.student_id where a.day = d),
    cls as (select class_name from roll union select class_name from att where class_name <> '')
    select jsonb_build_object('day', d,
      'students', (select count(*) from att),
      'absent', (select count(*) from att where status in ('absent', 'excused')),
      'classes', coalesce((select jsonb_agg(jsonb_build_object(
          'class_name', c.class_name, 'students', coalesce(r.n, 0),
          'recorded', exists (select 1 from att a where a.class_name = c.class_name),
          'recorded_by', (select max(a.recorded_by) from att a where a.class_name = c.class_name),
          'absent', coalesce((select jsonb_agg(jsonb_build_object('student_id', a.student_id, 'name', a.full_name, 'note', a.note) order by a.full_name)
                              from att a where a.class_name = c.class_name and a.status in ('absent', 'excused')), '[]'::jsonb)) order by c.class_name)
        from cls c left join roll r on r.class_name = c.class_name), '[]'::jsonb))
  );
end $$;

-- لوحة المؤشرات (مثل الرئيسية في الموقع). المشرف يرى الغياب فقط
create or replace function public.api_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d date := public.api_today();
  mon text := public.transport_current_cycle(d);
  wd text := (array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'])[extract(dow from d)::int + 1];
  days jsonb;
  att jsonb; res jsonb;
begin
  perform public.api_need('superadmin', 'manager', 'supervisor');
  select c.days into days from timetable_config c where c.id = 1;
  with roll as (select x.class_name from students x where x.status in ('final', 'reserve') and x.class_name <> '' group by x.class_name),
  a as (select * from attendance where day = d)
  select jsonb_build_object(
    'school_day', days is null or jsonb_array_length(days) = 0 or days ? wd, 'weekday', wd,
    'taken', (select count(*) from a), 'absent', (select count(*) from a where status in ('absent', 'excused')),
    'classes_missing', (select count(*) from roll r where not exists (select 1 from a where a.class_name = r.class_name)))
  into att;
  res := jsonb_build_object('day', d, 'attendance', att);
  if public.my_role() = 'supervisor' then return res; end if;

  return res || (
    with rec as (select * from public.api_receipt_rows((public.transport_cycle(mon) ->> 'from')::date, d)),
    due as (select * from public.api_transport_dues(mon)),
    caps as (
      select e ->> 'name' as name, case when (e ->> 'capacity') ~ '^[0-9]+$' and (e ->> 'capacity')::int > 0 then (e ->> 'capacity')::int end as cap
      from settings s, jsonb_array_elements(case when jsonb_typeof(s.classes) = 'object' then coalesce(s.classes -> 'list', '[]'::jsonb) else '[]'::jsonb end) e
      where s.id = 1 and jsonb_typeof(e) = 'object'
    ), filled as (
      select c.name, c.cap, (select count(*) from students x where x.status in ('final', 'reserve') and x.class_name = c.name) as n from caps c where c.cap is not null
    )
    select jsonb_build_object(
      'cycle', public.transport_cycle(mon),
      'collected_today', jsonb_build_object('total', coalesce((select sum(amount) from rec where paid_on = d), 0), 'cash', coalesce((select sum(amount) from rec where paid_on = d and method = 'cash'), 0),
                                            'count', (select count(*) from rec where paid_on = d)),
      'collected_month', jsonb_build_object('total', coalesce((select sum(amount) from rec), 0), 'cash', coalesce((select sum(amount) from rec where method = 'cash'), 0), 'count', (select count(*) from rec)),
      'late', jsonb_build_object('count', (select count(*) from due where state = 'late'), 'owed', coalesce((select sum(left_amount) from due where state = 'late'), 0),
                                 'suspended', (select count(*) from due where state = 'suspended'), 'deadline', public.api_deadline(mon)),
      'new_students', jsonb_build_object(
          'month', (select count(*) from students x where to_char(x.created_at at time zone 'UTC', 'YYYY-MM') = mon),
          'week', (select count(*) from students x where (x.created_at at time zone 'UTC')::date >= ((now() at time zone 'UTC')::date - 6)),
          'pending', (select count(*) from students x where x.status not in ('final', 'reserve', 'dropped'))),
      'classes', jsonb_build_object('full', coalesce((select jsonb_agg(name) from filled where n = cap), '[]'::jsonb),
                                    'over', coalesce((select jsonb_agg(name) from filled where n > cap), '[]'::jsonb)))
  );
end $$;

-- بحث في الطلاب: بالاسم أو اسم ولي الأمر، أو بأرقام الهوية أو الهاتف؛ وتصفية بالشعبة والحالة (final / reserve / pending / dropped)
create or replace function public.api_students(p_q text default '', p_class text default '', p_status text default '', p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := public.api_norm(p_q);
  dg text := regexp_replace(translate(coalesce(p_q, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
begin
  perform public.api_need('superadmin', 'manager');
  return (
    with f as (
      select x.* from students x
      where (coalesce(p_class, '') = '' or x.class_name = p_class)
        and (coalesce(p_status, '') = '' or (case when x.status in ('final', 'reserve', 'dropped') then x.status else 'pending' end) = p_status)
        and (q = '' or position(q in public.api_norm(x.full_name || ' ' || coalesce(x.guardian_name, ''))) > 0
             or (length(dg) >= 3 and (position(dg in coalesce(x.national_id, '')) > 0 or position(dg in coalesce(x.phone, '')) > 0 or position(dg in coalesce(x.whatsapp, '')) > 0)))
    )
    select jsonb_build_object('total', (select count(*) from f),
      'students', coalesce((select jsonb_agg(row_to_json(s)) from (
        select f.id, f.full_name, f.class_name, case when f.status in ('final', 'reserve', 'dropped') then f.status else 'pending' end as status,
               f.guardian_name, f.phone, f.whatsapp, g.assembly_point as bus
        from f left join transport_members m on m.student_id = f.id left join transport_groups g on g.id = m.group_id
        order by f.full_name collate public.api_ar, f.id limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) s), '[]'::jsonb))
  );
end $$;

-- ملف الطالب: بياناته، غيابه هذا العام الدراسي، اشتراكه في المواصلات وإيصالاته ومطلوب الشهر الحالي
create or replace function public.api_student_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  x students;
  y0 date := make_date(extract(year from public.api_today())::int - case when extract(month from public.api_today()) < 9 then 1 else 0 end, 9, 1);
  mon text := public.transport_current_cycle(public.api_today());
begin
  perform public.api_need('superadmin', 'manager');
  select * into x from students where id = p_id;
  if x.id is null then raise exception 'الطالب غير موجود'; end if;
  return jsonb_build_object(
    'student', to_jsonb(x) - 'form_answers',
    'attendance', jsonb_build_object('since', y0,
        'recorded_days', (select count(*) from attendance a where a.student_id = p_id and a.day >= y0),
        'absences', coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'note', a.note) order by a.day desc) from attendance a
                              where a.student_id = p_id and a.day >= y0 and a.status in ('absent', 'excused')), '[]'::jsonb)),
    'transport', (select jsonb_build_object('bus', g.assembly_point, 'pickup', m.pickup, 'left_from', m.left_from, 'exempt_from', m.exempt_from, 'exempt_to', m.exempt_to,
                     'suspended_month', m.suspended_month, 'grace_until', m.grace_until,
                     'this_month', (select to_jsonb(d) - 'student_id' - 'group_id' from public.api_transport_dues(mon) d where d.student_id = p_id))
                  from transport_members m join transport_groups g on g.id = m.group_id where m.student_id = p_id),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r) - 'student_id' order by r.paid_on desc, r.receipt_no desc)
                          from public.api_receipt_rows('2000-01-01', '2999-12-31') r where r.student_id = p_id), '[]'::jsonb)
  );
end $$;

-- ===================================================================================================
-- جدول الحصص والاحتياط
-- ===================================================================================================

-- أيام الدراسة كما في إعدادات الجدول (الحصة day = ترتيب اليوم فيها)
create or replace function public.api_tt_days() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(c.days) = 'array' and jsonb_array_length(c.days) > 0 then c.days end from timetable_config c where c.id = 1),
                  '["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]'::jsonb)
$$;

-- ترتيب يوم التاريخ في أيام الدراسة، أو -1 إن لم يكن يوم دراسة
create or replace function public.api_tt_day_index(p_day date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (e.i - 1)::int from jsonb_array_elements_text(public.api_tt_days()) with ordinality e(name, i)
                   where e.name = (array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'])[extract(dow from p_day)::int + 1]), -1)
$$;

-- موعد الحصة لشعبة: من مرحلتها في «مواعيد الدوام» (الشعبة التي لم تُضف إلى مرحلة تتبع آخر مرحلة). { from, to } أو null
create or replace function public.api_period_time(p_class text, p_period int) returns jsonb
language sql stable security definer set search_path = public as $$
  with st as (
    select s.value as stage, s.i from timetable_config c, jsonb_array_elements(coalesce(c.bells -> 'stages', '[]'::jsonb)) with ordinality s(value, i) where c.id = 1
  ), pick as (
    select stage from st where coalesce(stage -> 'classes', '[]'::jsonb) ? p_class
    union all
    select stage from (select stage from st order by i desc limit 1) l
    limit 1
  ), periods as (
    select r.value, row_number() over (order by r.i) as n
    from pick, jsonb_array_elements(coalesce(pick.stage -> 'rows', '[]'::jsonb)) with ordinality r(value, i) where r.value ->> 'k' = 'p'
  )
  select jsonb_build_object('from', value ->> 'f', 'to', value ->> 't') from periods where n = p_period
$$;

create or replace function public.api_fix_subject(p text) returns text
language sql immutable as $$ select case when btrim(coalesce(p, '')) = 'قرأن' then 'قرآن' else btrim(coalesce(p, '')) end $$;

-- جدول معلم أو شعبة. المعلم صاحب الحساب يرى جدوله بلا وسائط (ويمكنه عرض جدول شعبة)
create or replace function public.api_timetable(p_teacher uuid default null, p_class text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid; t uuid := p_teacher;
begin
  perform public.api_need('superadmin', 'manager', 'supervisor', 'teacher');
  if public.my_role() = 'teacher' then
    select teacher_id into me from profiles where id = auth.uid();
    if t is not null and t is distinct from me then raise exception 'ليس لديك صلاحية لجدول معلم آخر'; end if;
    if coalesce(p_class, '') = '' then t := me; end if;
  end if;
  if t is null and coalesce(p_class, '') = '' then raise exception 'حدّد المعلم أو الشعبة'; end if;
  return jsonb_build_object('days', public.api_tt_days(),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'day_name', public.api_tt_days() ->> s.day, 'period', s.period,
        'time', public.api_period_time(s.class_name, s.period), 'class_name', s.class_name, 'subject', public.api_fix_subject(s.subject),
        'teacher_id', s.teacher_id, 'teacher', te.name) order by s.day, s.period, s.class_name)
      from timetable_sessions s left join teachers te on te.id = s.teacher_id
      where s.status <> 'removed' and (t is null or s.teacher_id = t) and (coalesce(p_class, '') = '' or s.class_name = p_class)), '[]'::jsonb));
end $$;

-- حصص الاحتياط المطلوبة من المعلم صاحب الحساب (من اليوم ولعدد من الأيام)
create or replace function public.api_my_substitutes(p_from date default null, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid; d0 date := coalesce(p_from, public.api_today());
begin
  perform public.api_need('teacher', 'supervisor', 'superadmin');
  select teacher_id into me from profiles where id = auth.uid();
  if me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'period', s.period, 'time', public.api_period_time(s.class_name, s.period),
      'class_name', s.class_name, 'subject', s.subject, 'absent_teacher', te.name) order by s.day, s.period)
    from substitutions s left join teachers te on te.id = s.absent_teacher_id
    where s.sub_teacher_id = me and s.day between d0 and d0 + greatest(coalesce(p_days, 7), 1) - 1), '[]'::jsonb);
end $$;

-- البدلاء المحتملون لحصة، مرتبين كما في الموقع (subCandidates): متاح في الحصة وليس غائبًا ولا يغطي غيرها؛
-- ثم من في المدرسة ذلك اليوم، ثم غير محفّظي القرآن، ثم الأقل احتياطًا اليوم ثم في الشهر، ثم من يدرّس الشعبة، ثم المادة نفسها، ثم الأخف يومًا
create or replace function public.api_sub_candidates(p_day date, p_class text, p_period int)
returns table (teacher_id uuid, name text, on_site boolean, quran boolean, today_count int, month_count int, teaches_class boolean, same_subject boolean, load int)
language sql stable security definer set search_path = public as $$
  with di as (select public.api_tt_day_index(p_day) as i),
  live as (select * from timetable_sessions where status <> 'removed'),
  lesson as (select l.* from live l, di where l.day = di.i and l.period = p_period and l.class_name = p_class limit 1),
  ab as (select a.teacher_id, a.periods from teacher_absences a where a.day = p_day),
  subs_day as (select * from substitutions where day = p_day and sub_teacher_id is not null),
  subs_month as (select sub_teacher_id, count(*) as n from substitutions where sub_teacher_id is not null and to_char(day, 'YYYY-MM') = to_char(p_day, 'YYYY-MM') group by sub_teacher_id)
  select t.id, t.name,
    exists (select 1 from live x, di where x.teacher_id = t.id and x.day = di.i),
    (to_jsonb(t) ->> 'category' = 'محفظون') or not exists (select 1 from live x where x.teacher_id = t.id and public.api_norm(public.api_fix_subject(x.subject)) <> public.api_norm('قرآن')),
    (select count(*) from subs_day s where s.sub_teacher_id = t.id)::int,
    coalesce((select n from subs_month m where m.sub_teacher_id = t.id), 0)::int,
    exists (select 1 from live x, lesson l where x.teacher_id = t.id and x.class_name = l.class_name),
    exists (select 1 from live x, lesson l where x.teacher_id = t.id and public.api_norm(public.api_fix_subject(x.subject)) = public.api_norm(public.api_fix_subject(l.subject))),
    (select count(*) from live x, di where x.teacher_id = t.id and x.day = di.i)::int
  from teachers t, lesson l
  where t.id is distinct from l.teacher_id
    and exists (select 1 from live x where x.teacher_id = t.id)
    and not exists (select 1 from ab where ab.teacher_id = t.id and (ab.periods is null or cardinality(ab.periods) = 0 or p_period = any (ab.periods)))
    and not exists (select 1 from live x, di where x.teacher_id = t.id and x.day = di.i and x.period = p_period)
    and not exists (select 1 from subs_day s where s.sub_teacher_id = t.id and s.period = p_period and s.class_name <> p_class)
  order by 3 desc, 4 asc, 5 asc, 6 asc, 7 desc, 8 desc, 9 asc, t.name collate public.api_ar
$$;

-- الاحتياط في يوم: المعلمون الغائبون، وحصصهم، ومن عُيّن لكل حصة، وأفضل البدلاء
create or replace function public.api_subs_day(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, public.api_today()); di int;
begin
  perform public.api_need('superadmin', 'manager', 'supervisor');
  di := public.api_tt_day_index(d);
  if di < 0 then return jsonb_build_object('day', d, 'school_day', false, 'absences', '[]'::jsonb, 'lessons', '[]'::jsonb); end if;
  return jsonb_build_object('day', d, 'school_day', true,
    'absences', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'teacher_id', a.teacher_id, 'teacher', te.name, 'periods', a.periods, 'reason', a.reason) order by te.name)
                          from teacher_absences a left join teachers te on te.id = a.teacher_id where a.day = d), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('period', s.period, 'time', public.api_period_time(s.class_name, s.period), 'class_name', s.class_name,
        'subject', public.api_fix_subject(s.subject), 'absent_teacher_id', s.teacher_id, 'absent_teacher', te.name,
        'substitute_id', r.sub_teacher_id, 'substitute', st.name,
        'candidates', coalesce((select jsonb_agg(to_jsonb(c)) from (select * from public.api_sub_candidates(d, s.class_name, s.period) limit 5) c), '[]'::jsonb))
        order by s.period, s.class_name)
      from timetable_sessions s
      join teacher_absences a on a.teacher_id = s.teacher_id and a.day = d
      left join teachers te on te.id = s.teacher_id
      left join substitutions r on r.day = d and r.class_name = s.class_name and r.period = s.period
      left join teachers st on st.id = r.sub_teacher_id
      where s.status <> 'removed' and s.day = di and (a.periods is null or cardinality(a.periods) = 0 or s.period = any (a.periods))), '[]'::jsonb));
end $$;

-- تسجيل غياب معلم ليوم (كله: p_periods فارغ، أو حصص منه)، أو إلغاؤه مع ما وُزّع عنه من احتياط
create or replace function public.api_teacher_absence(p_day date, p_teacher uuid, p_periods smallint[] default null, p_reason text default '', p_remove boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  perform public.api_need('superadmin', 'supervisor');
  if p_day is null or p_teacher is null then raise exception 'حدّد اليوم والمعلم'; end if;
  if p_remove then
    delete from substitutions where day = p_day and absent_teacher_id = p_teacher;
    delete from teacher_absences where day = p_day and teacher_id = p_teacher;
    return jsonb_build_object('removed', true);
  end if;
  if not exists (select 1 from teachers where id = p_teacher) then raise exception 'المعلم غير موجود'; end if;
  select coalesce(nullif(full_name, ''), email) into who from profiles where id = auth.uid();
  insert into teacher_absences (day, teacher_id, periods, reason, created_by)
  values (p_day, p_teacher, case when cardinality(p_periods) > 0 then p_periods end, coalesce(p_reason, ''), coalesce(who, ''))
  on conflict (day, teacher_id) do update set periods = excluded.periods, reason = excluded.reason;
  return public.api_subs_day(p_day);
end $$;

-- تعيين معلم احتياط لحصة (أو إلغاء التعيين بـ p_teacher فارغ). يُرفض من ليس متاحًا في تلك الحصة
create or replace function public.api_assign_substitute(p_day date, p_class text, p_period int, p_teacher uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s timetable_sessions; who text;
begin
  perform public.api_need('superadmin', 'supervisor');
  select x.* into s from timetable_sessions x
  join teacher_absences a on a.teacher_id = x.teacher_id and a.day = p_day
  where x.status <> 'removed' and x.day = public.api_tt_day_index(p_day) and x.class_name = p_class and x.period = p_period
    and (a.periods is null or cardinality(a.periods) = 0 or x.period = any (a.periods))
  limit 1;
  if s.id is null then raise exception 'لا توجد حصة لمعلم غائب في هذه الشعبة والحصة'; end if;
  if p_teacher is not null and not exists (select 1 from public.api_sub_candidates(p_day, p_class, p_period) c where c.teacher_id = p_teacher) then
    raise exception 'هذا المعلم غير متاح في هذه الحصة (عنده حصة، أو غائب، أو يغطي حصة أخرى)';
  end if;
  select coalesce(nullif(full_name, ''), email) into who from profiles where id = auth.uid();
  insert into substitutions (day, period, class_name, subject, absent_teacher_id, sub_teacher_id, created_by)
  values (p_day, p_period, p_class, public.api_fix_subject(s.subject), s.teacher_id, p_teacher, coalesce(who, ''))
  on conflict (day, class_name, period) do update set sub_teacher_id = excluded.sub_teacher_id, absent_teacher_id = excluded.absent_teacher_id, subject = excluded.subject;
  return public.api_subs_day(p_day);
end $$;

-- ===================================================================================================
-- تسجيل الغياب من حساب المعلم: بقيود رابط الغياب نفسها (ليوم اليوم فقط، وأسماء الطلاب فقط)
-- ===================================================================================================

create or replace function public.api_att_who() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select te.name from profiles p join teachers te on te.id = p.teacher_id where p.id = auth.uid()),
                  (select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid()), '')
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

-- النسخة المعتمدة من api_att_roll في student_suspensions.sql. هنا تُنشأ فقط إن لم تكن موجودة (تثبيت جديد)،
-- حتى لا تُرجِع إعادة تشغيل هذا الملف نسخة أقدم منها
do $guard$ begin
  if not exists (select 1 from pg_proc where proname = 'api_att_roll' and pronamespace = 'public'::regnamespace) then
    execute $fn$
create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin', 'attclerk');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$
    $fn$;
  end if;
end $guard$;

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

-- ===================================================================================================
-- أولياء الأمور (بالرابط السري، بلا حساب)
-- ===================================================================================================

create or replace function public.api_parent_view(p_token text) returns jsonb
language sql security definer set search_path = public as $$ select public.parent_view(p_token) $$;

-- أجهزة أولياء الأمور: تمهيدًا لإشعارات التطبيق (إشعار الغياب مثلًا). الجهاز يُربط برابط ولي الأمر
create table if not exists public.parent_devices (
  device_token text primary key,
  parent_token text not null references public.parent_links (token) on delete cascade,
  platform text not null default '' check (platform in ('', 'android', 'ios')),
  updated_at timestamptz not null default now()
);
alter table public.parent_devices enable row level security;
revoke all on public.parent_devices from anon, authenticated;
grant select on public.parent_devices to authenticated;
drop policy if exists parent_devices_admin on public.parent_devices;
create policy parent_devices_admin on public.parent_devices for select to authenticated using (public.my_role() = 'superadmin');

create or replace function public.api_register_device(p_token text, p_device text, p_platform text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from parent_links where token = p_token and active) then return jsonb_build_object('error', 'الرابط غير صالح أو أُلغي'); end if;
  if length(coalesce(p_device, '')) < 20 then return jsonb_build_object('error', 'معرّف الجهاز غير صالح'); end if;
  insert into parent_devices (device_token, parent_token, platform, updated_at)
  values (p_device, p_token, case when p_platform in ('android', 'ios') then p_platform else '' end, now())
  on conflict (device_token) do update set parent_token = excluded.parent_token, platform = excluded.platform, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_unregister_device(p_device text) returns jsonb
language sql security definer set search_path = public as $$
  delete from parent_devices where device_token = p_device returning jsonb_build_object('ok', true)
$$;

-- ===================================================================================================
-- الصلاحيات: الدوال المساعدة لا تُستدعى مباشرة (تقرأ بلا قيود)، والواجهة لأصحاب الحسابات، ودوال ولي الأمر لمن يملك الرابط
-- ===================================================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'api_need(text[])', 'api_deadline(text)', 'api_transport_dues(text)', 'api_receipt_rows(date, date)',
    'api_tt_days()', 'api_tt_day_index(date)', 'api_period_time(text, integer)', 'api_sub_candidates(date, text, integer)', 'api_att_who()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'api_ledger(date, date)', 'api_late_payers(text)', 'api_attendance_day(date)', 'api_dashboard()', 'api_students(text, text, text, integer, integer)',
    'api_student_file(uuid)', 'api_timetable(uuid, text)', 'api_my_substitutes(date, integer)', 'api_subs_day(date)',
    'api_teacher_absence(date, uuid, smallint[], text, boolean)', 'api_assign_substitute(date, text, integer, uuid)',
    'api_att_classes()', 'api_att_roll(text)', 'api_att_submit(text, uuid[])'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['api_parent_view(text)', 'api_register_device(text, text, text)', 'api_unregister_device(text)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;



-- ================================================================
-- audit_log.sql
-- ================================================================
-- سجل التعديلات: من أضاف أو عدّل أو حذف ماذا ومتى، في الجداول المهمة.
-- يكتبه القاعدة نفسها (triggers) عند كل تغيير، سواء من البرنامج أو من محرر SQL، فلا يمكن تجاوزه من الصفحة.
-- يقرؤه المدير العام وحده، ولا يملك أحد تعديله أو حذفه من البرنامج.
-- لا يُسجَّل فيه ما فيه أسرار (كلمة المرور الافتراضية، روابط الغياب السرية، مفتاح البوت).
-- شغّل هذا الملف في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة، ويبدأ التسجيل من لحظة تشغيله.
-- يُعاد تشغيله بأمان متى أُضيفت جداول إلى قائمته (آخر إضافة: الدرجات، شئون الطلاب، سندات الصرف، الطلبيات، العهد، اللجان، الزيارات).

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,                         -- صاحب الحساب الذي نفّذ التغيير (فارغ: من محرر SQL أو رابط الغياب)
  user_name text not null default '',
  tbl text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_key text not null default '',     -- ما يُعرف به السجل (المعرّف، أو الطالب والشهر، أو رقم الإيصال)
  student_id uuid,                      -- الطالب المعني إن وُجد، للبحث باسمه
  receipt_no bigint,                    -- رقم الإيصال إن وُجد
  old jsonb,                            -- في التعديل: الحقول التي تغيّرت فقط، بقيمها قبل وبعد في old و new
  new jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_student_idx on public.audit_log (student_id);
create index if not exists audit_log_receipt_idx on public.audit_log (receipt_no);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.my_role() = 'superadmin');

-- اسم صاحب الحساب الحالي
create or replace function public.audit_who() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid()), '')
$$;

-- سطر لكل سجل تغيّر. وسائط الـ trigger: أعمدة مفتاح السجل (مثل 'id' أو 'student_id', 'month')
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  oc jsonb := '{}'::jsonb;
  nc jsonb := '{}'::jsonb;
  k text;
  rkey text := '';
  who text := public.audit_who();
  i int;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
        oc := oc || jsonb_build_object(k, o -> k);
        nc := nc || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if oc = '{}'::jsonb then return null; end if;   -- حفظ بلا تغيير فعلي
    o := oc; n := nc;
  end if;
  for i in 0 .. tg_nargs - 1 loop
    rkey := concat_ws(' | ', nullif(rkey, ''), r ->> tg_argv[i]);
  end loop;
  -- من لم يدخل بحساب (محرر SQL): يُؤخذ الاسم المكتوب في السجل إن وُجد
  if who = '' then who := coalesce(nullif(r ->> 'updated_by', ''), nullif(r ->> 'issued_by', ''), case when auth.uid() is null then 'محرر SQL / النظام' else '' end); end if;
  insert into audit_log (user_id, user_name, tbl, action, row_key, student_id, receipt_no, old, new)
  values (auth.uid(), who, tg_table_name, lower(tg_op), rkey,
    case when tg_table_name = 'students' then (r ->> 'id')::uuid
         when r ? 'student_id' and (r ->> 'student_id') ~ '^[0-9a-f-]{36}$' then (r ->> 'student_id')::uuid end,
    case when (r ->> 'receipt_no') ~ '^[0-9]+$' then (r ->> 'receipt_no')::bigint end,
    o, n);
  return null;
end $$;

-- الغياب: سطر واحد لكل شعبة ويوم في كل عملية حفظ، لا سطر لكل طالب
create or replace function public.audit_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.audit_who();
  g record;
begin
  if tg_op = 'INSERT' then
    for g in select day, class_name, count(*) as n, count(*) filter (where status in ('absent', 'excused')) as a, max(recorded_by) as rb
             from new_rows group by day, class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.rb, ''), 'رابط الغياب'), 'attendance', 'insert', g.class_name || ' | ' || g.day,
        jsonb_build_object('day', g.day, 'class_name', g.class_name, 'students', g.n, 'absent', g.a));
    end loop;
  elsif tg_op = 'UPDATE' then
    for g in select n.day, n.class_name, max(n.recorded_by) as rb,
               jsonb_agg(jsonb_build_object('student_id', n.student_id, 'from', o.status, 'to', n.status)) as ch
             from new_rows n join old_rows o on o.student_id = n.student_id and o.day = n.day
             where o.status is distinct from n.status
             group by n.day, n.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.rb, ''), 'رابط الغياب'), 'attendance', 'update', g.class_name || ' | ' || g.day,
        jsonb_build_object('day', g.day, 'class_name', g.class_name, 'changes', g.ch));
    end loop;
  else
    for g in select day, class_name, count(*) as n from old_rows group by day, class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, old)
      values (auth.uid(), coalesce(nullif(who, ''), 'رابط الغياب'), 'attendance', 'delete', g.class_name || ' | ' || g.day,
        jsonb_build_object('day', g.day, 'class_name', g.class_name, 'students', g.n));
    end loop;
  end if;
  return null;
end $$;

-- الدرجات: سطر واحد لكل اختبار ومادة وشعبة في كل عملية حفظ، لا سطر لكل طالب. في التعديل: من تغيّرت درجته، من كم إلى كم
create or replace function public.audit_grades() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.audit_who();
  g record;
begin
  if tg_op = 'INSERT' then
    for g in select i.name as item, n.subject, coalesce(x.class_name, '') as class_name, count(*) as n, max(n.updated_by) as ub
             from new_rows n left join grade_items i on i.id = n.item_id left join students x on x.id = n.student_id
             where n.score is not null group by i.name, n.subject, x.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.ub, ''), 'محرر SQL / النظام'), 'grades', 'insert', concat_ws(' | ', g.item, g.subject, g.class_name),
        jsonb_build_object('item', g.item, 'subject', g.subject, 'class_name', g.class_name, 'students', g.n));
    end loop;
  elsif tg_op = 'UPDATE' then
    for g in select i.name as item, n.subject, coalesce(x.class_name, '') as class_name, max(n.updated_by) as ub,
               jsonb_agg(jsonb_build_object('student_id', n.student_id, 'from', o.score, 'to', n.score)) as ch
             from new_rows n join old_rows o on o.student_id = n.student_id and o.item_id = n.item_id and o.subject = n.subject
             left join grade_items i on i.id = n.item_id left join students x on x.id = n.student_id
             where o.score is distinct from n.score group by i.name, n.subject, x.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, new)
      values (auth.uid(), coalesce(nullif(who, ''), nullif(g.ub, ''), 'محرر SQL / النظام'), 'grades', 'update', concat_ws(' | ', g.item, g.subject, g.class_name),
        jsonb_build_object('item', g.item, 'subject', g.subject, 'class_name', g.class_name, 'changes', g.ch));
    end loop;
  else
    for g in select i.name as item, o.subject, coalesce(x.class_name, '') as class_name, count(*) as n
             from old_rows o left join grade_items i on i.id = o.item_id left join students x on x.id = o.student_id
             group by i.name, o.subject, x.class_name loop
      insert into audit_log (user_id, user_name, tbl, action, row_key, old)
      values (auth.uid(), coalesce(nullif(who, ''), 'محرر SQL / النظام'), 'grades', 'delete', concat_ws(' | ', g.item, g.subject, g.class_name),
        jsonb_build_object('item', g.item, 'subject', g.subject, 'class_name', g.class_name, 'students', g.n));
    end loop;
  end if;
  return null;
end $$;

-- ربط الجداول. كل جدول غير موجود بعد يُتخطّى، فيمكن تشغيل الملف مرة أخرى بعد إضافة جداول جديدة
do $$
declare
  t record;
begin
  for t in select * from (values
      ('students', 'id'), ('teachers', 'id'), ('profiles', 'id'), ('settings', 'id'),
      ('transport_groups', 'id'), ('transport_members', 'student_id'), ('transport_payments', 'student_id, month'),
      ('transport_topups', 'receipt_no'), ('transport_refunds', 'refund_no'), ('transport_voided', 'receipt_no'),
      ('timetable_sessions', 'id'), ('timetable_config', 'id'), ('timetable_proposals', 'id'),
      ('grade_items', 'id'), ('student_leaves', 'id'), ('discipline_records', 'id'), ('student_exits', 'id'),
      ('payment_claims', 'no'), ('orders', 'no'), ('custody_items', 'id'), ('committees', 'id'), ('committee_members', 'id'),
      ('student_lists', 'id'), ('visits', 'id'), ('statements', 'id')
    ) as v(name, keys)
  loop
    if to_regclass('public.' || t.name) is null then continue; end if;
    execute format('drop trigger if exists audit_row on public.%I', t.name);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%s)',
      t.name, (select string_agg(quote_literal(trim(k)), ', ') from unnest(string_to_array(t.keys, ',')) k));
  end loop;

  if to_regclass('public.attendance') is not null then
    drop trigger if exists audit_att_ins on public.attendance;
    drop trigger if exists audit_att_upd on public.attendance;
    drop trigger if exists audit_att_del on public.attendance;
    create trigger audit_att_ins after insert on public.attendance referencing new table as new_rows
      for each statement execute function public.audit_attendance();
    create trigger audit_att_upd after update on public.attendance referencing old table as old_rows new table as new_rows
      for each statement execute function public.audit_attendance();
    create trigger audit_att_del after delete on public.attendance referencing old table as old_rows
      for each statement execute function public.audit_attendance();
  end if;

  if to_regclass('public.grades') is not null then
    drop trigger if exists audit_grd_ins on public.grades;
    drop trigger if exists audit_grd_upd on public.grades;
    drop trigger if exists audit_grd_del on public.grades;
    create trigger audit_grd_ins after insert on public.grades referencing new table as new_rows
      for each statement execute function public.audit_grades();
    create trigger audit_grd_upd after update on public.grades referencing old table as old_rows new table as new_rows
      for each statement execute function public.audit_grades();
    create trigger audit_grd_del after delete on public.grades referencing old table as old_rows
      for each statement execute function public.audit_grades();
  end if;
end $$;



-- ================================================================
-- outside_accounts.sql
-- ================================================================
-- Outside and test accounts.
-- 1) A staff record can be marked «ليس من العاملين» (a test account, or the body that supervises the school):
--    it keeps its login but never appears in staff attendance, evaluations, timetables, substitutes or staff transport.
-- 2) An account can be «جهة مشرفة (مشاهدة وتصدير فقط)»: the manager's role (it sees what the manager sees) with read_only set,
--    so it can write nothing at all, not even what the manager may edit (staff attendance and official hours).
--    This is enforced here, on every table, not only by hiding buttons on the page.
-- Run this file once in the Supabase SQL Editor, after schema.sql, manager.sql and staff_attendance.sql. Safe to re-run.
-- It does not change existing data. Tables added later: re-run this file so they get the same block.

alter table public.teachers add column if not exists not_staff boolean not null default false;
alter table public.profiles add column if not exists read_only boolean not null default false;

-- Only the superadmin changes profiles already (profiles_update in schema.sql), so nobody can lift their own read_only.

create or replace function public.my_read_only() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select read_only from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.my_read_only() from public, anon;
grant execute on function public.my_read_only() to authenticated;

-- A restrictive policy is added (AND) to whatever the table already allows: a read-only account can still read
-- what its role reads, and can never insert, update or delete. Functions that run as their owner (the bots, the
-- links) are not affected.
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists read_only_no_insert on public.%I', t);
    execute format('create policy read_only_no_insert on public.%I as restrictive for insert to authenticated with check (not public.my_read_only())', t);
    execute format('drop policy if exists read_only_no_update on public.%I', t);
    execute format('create policy read_only_no_update on public.%I as restrictive for update to authenticated using (not public.my_read_only()) with check (not public.my_read_only())', t);
    execute format('drop policy if exists read_only_no_delete on public.%I', t);
    execute format('create policy read_only_no_delete on public.%I as restrictive for delete to authenticated using (not public.my_read_only())', t);
  end loop;
end $$;

