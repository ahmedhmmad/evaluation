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
  -- غير مسموح: تُتجاهل صورته بصمت. مسموح لكن لم يبدأ بـ«دوام»: يُذكَّر بذلك
  if who.phone is null then
    return jsonb_build_object('ok', false, 'allowed', false, 'note', 'الرقم +' || att_phone(p_phone) || ' ليس من الأرقام المسموحة في «دوام الموظفين»؛ تُتجاهل صورته');
  end if;
  if not exists (select 1 from staff_bot_state where phone = right(att_phone(p_phone), 9) and step = 'image' and updated_at > now() - interval '30 minutes') then
    return jsonb_build_object('ok', false, 'allowed', true, 'note', 'لإرسال كشف الدوام أرسل كلمة «دوام» أولًا، ثم الصورة.');
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
