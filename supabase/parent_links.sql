-- رابط خاص لكل ولي أمر (parent.html?t=…): يرى منه أبناءه المسجلين فقط — غيابهم، وإيصالات المواصلات، وجدول حصص شعبهم — دون حساب.
-- ولي الأمر يُعرَف برقم هويته في ملف التسجيل، وإن لم يوجد فبرقم الجوال، وإلا فالرابط للطالب وحده.
-- يُنشئ المدير العام الروابط ويلغيها من شاشة «روابط أولياء الأمور»؛ وكل شيء يمر عبر الدوال أدناه.
-- لا يظهر في الرابط أي رقم هاتف أو هوية، ولا بيانات أي طالب آخر.
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد attendance.sql و timetable.sql). لا يغيّر أي بيانات موجودة.

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
