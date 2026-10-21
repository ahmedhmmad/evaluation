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
-- الإخوة: يجمعهم رقم هوية ولي الأمر أو الهاتف (آخر 10 أرقام) أو اسم الأب والجد والعائلة؛ والأول من بدأ اشتراكه أولًا (شهر أول دفعة ثم يوم سدادها؛ من دفعوا في يوم واحد بالسن) ثم الأكبر سنًّا ثم بالاسم.
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
    select p.student_id as sid, min(p.month) as m,
           min(p.month || '#' || coalesce(left(p.paid_on::text, 10), '9999')) as k   -- أول دفعة: شهرها ثم يوم سدادها
    from transport_payments p where p.amount > 0 group by p.student_id
  ), pay as (
    select p.student_id as sid, p.amount, p.due from transport_payments p where p.month = p_month
  ), mem as (
    select m.student_id as sid, m.group_id as gid, m.share as mshare, m.left_from, m.exempt_from, m.exempt_to, m.grace_until, m.suspended_month,
           x.full_name, x.phone, x.details, to_jsonb(x) ->> 'birth_date' as birth, fp.m as first_m, fp.k as first_k, py.amount as pamount, py.due as pdue,
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
      row_number() over (partition by f.root order by coalesce(o.first_k, '9999'), coalesce(o.birth, '9999'), o.full_name collate public.api_ar) as rnk,
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
          'pending', (select count(*) from students x where x.status not in ('final', 'reserve'))),
      'classes', jsonb_build_object('full', coalesce((select jsonb_agg(name) from filled where n = cap), '[]'::jsonb),
                                    'over', coalesce((select jsonb_agg(name) from filled where n > cap), '[]'::jsonb)))
  );
end $$;

-- بحث في الطلاب: بالاسم أو اسم ولي الأمر، أو بأرقام الهوية أو الهاتف؛ وتصفية بالشعبة والحالة (final / reserve / pending)
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
        and (coalesce(p_status, '') = '' or (case when x.status in ('final', 'reserve') then x.status else 'pending' end) = p_status)
        and (q = '' or position(q in public.api_norm(x.full_name || ' ' || coalesce(x.guardian_name, ''))) > 0
             or (length(dg) >= 3 and (position(dg in coalesce(x.national_id, '')) > 0 or position(dg in coalesce(x.phone, '')) > 0 or position(dg in coalesce(x.whatsapp, '')) > 0)))
    )
    select jsonb_build_object('total', (select count(*) from f),
      'students', coalesce((select jsonb_agg(row_to_json(s)) from (
        select f.id, f.full_name, f.class_name, case when f.status in ('final', 'reserve') then f.status else 'pending' end as status,
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
  perform public.api_need('teacher', 'superadmin');
  return jsonb_build_object('teacher', public.api_att_who(), 'day', att_today(), 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.class_name, 'students', c.students,
      'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = c.class_name)) order by c.pos)
    from att_classes() c), '[]'::jsonb));
end $$;

create or replace function public.api_att_roll(p_class text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_need('teacher', 'superadmin');
  return jsonb_build_object('day', att_today(), 'recorded', exists (select 1 from attendance a where a.day = att_today() and a.class_name = p_class),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name,
      'absent', exists (select 1 from attendance a where a.student_id = r.id and a.day = att_today() and a.status in ('absent', 'excused'))) order by r.pos)
    from att_roll(p_class) r), '[]'::jsonb));
end $$;

create or replace function public.api_att_submit(p_class text, p_absent uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.api_need('teacher', 'superadmin');
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
