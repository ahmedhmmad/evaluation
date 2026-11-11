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
end $$;
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
end $$;

-- قالب رسالة الإجازة لولي الأمر: يُعدَّل من «رسائل واتساب» ← «القوالب».
-- {الاسم} {من} {إلى} {السبب} {التمني} {الأكاديمية} تُستبدل عند الإرسال (التمني بحسب نوع الإجازة: مرض، سفر…)
insert into public.wa_templates (key, title, body, sort) values
  ('leave', 'إجازة طالب', E'السلام عليكم ورحمة الله وبركاته،\nولي أمر الطالب/ة {الاسم} المحترم،\nنفيدكم بأنه تم تسجيل إجازة لابنكم/ابنتكم من {من} إلى {إلى} بسبب {السبب}، ولن يُحتسب غيابه/ا خلالها.\n{التمني}.\n{الأكاديمية}', 6)
on conflict (key) do nothing;
