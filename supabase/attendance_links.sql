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
create or replace function public.att_save(p_class text, p_absent uuid[], p_by text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into attendance (student_id, day, status, note, class_name, recorded_by, updated_at)
  select s.id, att_today(), case when s.id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end,
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

create or replace function public.att_bot_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from attendance_settings where id = 1 and bot_key = p_key and length(coalesce(p_key, '')) >= 32)
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

-- The WhatsApp conversation. n8n passes each incoming message; the reply text comes back ('' = do not reply).
-- «غياب» → numbered classes → class number → numbered students → numbers of the absent (or 0) → saved.
create or replace function public.absence_bot(p_key text, p_phone text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ph text := att_phone(p_phone);
  msg text := btrim(translate(coalesce(p_text, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹،', '01234567890123456789,'));
  who text; st attendance_bot_state; cls text; total int; picks int[]; bad int[]; ids uuid[]; names text; reply text; recorded boolean;
begin
  if not att_bot_ok(p_key) then return jsonb_build_object('error', 'bad key: the n8n key does not match the one in the attendance screen'); end if;
  -- the number is matched on its last 9 digits, so 010…, +2010…, 0020… and a country code other than Egypt all match
  select name into who from attendance_tokens
  where active and length(ph) >= 9 and right(att_phone(phone), 9) = right(ph, 9) limit 1;
  -- not a registered teacher: stay silent (the note and number are for the n8n execution log only)
  if who is null then return jsonb_build_object('reply', '', 'note', 'number not registered', 'phone', ph); end if;

  select * into st from attendance_bot_state where phone = ph and updated_at > now() - interval '30 minutes';

  if msg in ('إلغاء', 'الغاء') then
    delete from attendance_bot_state where phone = ph;
    return jsonb_build_object('reply', case when st.phone is null then '' else 'أُلغي تسجيل الغياب.' end);
  end if;

  if msg in ('غياب', 'الغياب', 'غ') then
    select string_agg(c.pos || ') ' || c.class_name ||
      case when exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name) then ' ✓' else '' end, E'\n' order by c.pos)
      into reply from att_classes() c;
    if reply is null then return jsonb_build_object('reply', 'لا توجد شعب فيها طلاب مسجَّلون.'); end if;
    insert into attendance_bot_state (phone, step, class_name, updated_at) values (ph, 'class', '', now())
      on conflict (phone) do update set step = 'class', class_name = '', updated_at = now();
    return jsonb_build_object('reply', 'أهلًا ' || who || E'\nتسجيل غياب يوم ' || to_char(att_today(), 'DD/MM/YYYY') ||
      E'\nأرسل رقم الشعبة:\n\n' || reply || E'\n\n(✓ سُجّل غيابها اليوم؛ اختيارها يعدّل التسجيل) · «إلغاء» للخروج');
  end if;

  if st.phone is null then return jsonb_build_object('reply', '', 'note', 'not in a conversation: send «غياب» first', 'teacher', who); end if;

  if st.step = 'class' then
    if msg !~ '^[0-9]+$' then return jsonb_build_object('reply', 'أرسل رقم الشعبة فقط (مثل 3)، أو «إلغاء».'); end if;
    select c.class_name into cls from att_classes() c where c.pos = msg::int;
    if cls is null then return jsonb_build_object('reply', 'لا توجد شعبة بهذا الرقم. أرسل رقمًا من القائمة.'); end if;
    select string_agg(r.pos || ') ' || r.full_name ||
      case when exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused')) then ' (غائب)' else '' end, E'\n' order by r.pos)
      into reply from att_roll(cls) r;
    update attendance_bot_state set step = 'absent', class_name = cls, updated_at = now() where phone = ph;
    return jsonb_build_object('reply', 'طلاب ' || cls || E':\n\n' || reply ||
      E'\n\nأرسل أرقام الغائبين مفصولة بمسافة أو فاصلة (مثل: 3 7 12)\nأو 0 إن لم يغب أحد.');
  end if;

  if st.step = 'absent' then
    cls := st.class_name;
    select count(*) into total from att_roll(cls);
    if msg in ('0', 'لا يوجد', 'لايوجد', 'لا أحد', 'لا احد') then
      picks := '{}';
    elsif msg ~ '^[0-9 ,\-]+$' then
      select array_agg(distinct v::int) into picks from regexp_split_to_table(msg, '[ ,\-]+') v where v <> '';
    else
      return jsonb_build_object('reply', 'أرسل أرقام الغائبين فقط (مثل: 3 7 12)، أو 0 إن لم يغب أحد، أو «إلغاء».');
    end if;
    select array_agg(p) into bad from unnest(coalesce(picks, '{}')) p where p < 1 or p > total;
    if bad is not null then
      return jsonb_build_object('reply', 'هذه الأرقام ليست في القائمة: ' || array_to_string(bad, '، ') || E'\nأرسل الأرقام من 1 إلى ' || total || '.');
    end if;
    select array_agg(r.id), string_agg('• ' || r.full_name, E'\n' order by r.pos) into ids, names
      from att_roll(cls) r where r.pos = any(coalesce(picks, '{}'));
    perform att_save(cls, ids, who || ' (واتساب)');
    delete from attendance_bot_state where phone = ph;
    return jsonb_build_object('reply', '✅ سُجّل غياب ' || cls || ' ليوم ' || to_char(att_today(), 'DD/MM/YYYY') || E'\n' ||
      case when names is null then 'لا غائبين — الجميع حاضر.' else 'الغائبون (' || array_length(ids, 1) || E'):\n' || names end ||
      E'\n\nللتعديل أرسل «غياب» مرة أخرى.');
  end if;

  return jsonb_build_object('reply', '');
end $$;

revoke all on function public.att_today(), public.att_phone(text), public.att_classes(), public.att_roll(text), public.att_save(text, uuid[], text),
  public.att_token_name(text), public.att_bot_ok(text) from public, anon, authenticated;
grant execute on function public.absence_classes(text), public.absence_roll(text, text), public.absence_submit(text, text, uuid[]),
  public.absence_links(text), public.absence_missing(text), public.absence_bot(text, text, text) to anon, authenticated;
