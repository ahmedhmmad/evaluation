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
