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
