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
