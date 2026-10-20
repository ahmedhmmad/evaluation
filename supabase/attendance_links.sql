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
