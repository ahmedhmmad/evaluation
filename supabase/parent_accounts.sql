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
