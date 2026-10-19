-- حصص الاحتياط: غياب المعلمين (يومًا كاملًا أو حصصًا منه)، ومن يغطي كل حصة من حصصهم.
-- يسجّلها المدير العام والمشرف التربوي من «جدول الحصص ← الاحتياط»، ويراها المدير.
-- صفحة الممر (bells.html) تعرض احتياط اليوم: الشعبة والحصة والمادة واسم المعلم البديل فقط.
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد timetable.sql). لا يغيّر أي بيانات موجودة.

create table if not exists public.teacher_absences (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  periods smallint[],                   -- فارغ: اليوم كله؛ وإلا أرقام الحصص التي يغيبها
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (day, teacher_id)
);
create index if not exists teacher_absences_day_idx on public.teacher_absences (day);

create table if not exists public.substitutions (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  period smallint not null check (period between 1 and 12),
  class_name text not null,
  subject text not null default '',
  absent_teacher_id uuid references public.teachers (id) on delete set null,
  sub_teacher_id uuid references public.teachers (id) on delete set null,   -- فارغ: لم يُحدَّد بديل بعد
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (day, class_name, period)
);
create index if not exists substitutions_day_idx on public.substitutions (day);

alter table public.teacher_absences enable row level security;
alter table public.substitutions enable row level security;
revoke all on public.teacher_absences, public.substitutions from anon;
grant select, insert, update, delete on public.teacher_absences, public.substitutions to authenticated;

drop policy if exists teacher_absences_read on public.teacher_absences;
create policy teacher_absences_read on public.teacher_absences
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists teacher_absences_write on public.teacher_absences;
create policy teacher_absences_write on public.teacher_absences
  for all to authenticated using (public.my_role() in ('superadmin', 'supervisor')) with check (public.my_role() in ('superadmin', 'supervisor'));

drop policy if exists substitutions_read on public.substitutions;
create policy substitutions_read on public.substitutions
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists substitutions_write on public.substitutions;
create policy substitutions_write on public.substitutions
  for all to authenticated using (public.my_role() in ('superadmin', 'supervisor')) with check (public.my_role() in ('superadmin', 'supervisor'));

-- احتياط اليوم لصفحة الممر: بلا اسم المعلم الغائب ولا سبب غيابه
create or replace function public.public_subs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('period', s.period, 'class_name', s.class_name, 'subject', s.subject, 'teacher', t.name)
           order by s.period, s.class_name), '[]'::jsonb)
  from substitutions s join teachers t on t.id = s.sub_teacher_id
  where s.day = (now() at time zone 'Africa/Cairo')::date
$$;
revoke all on function public.public_subs() from public;
grant execute on function public.public_subs() to anon, authenticated;

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql): يشمل الجدولين الجديدين
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.teacher_absences;
    create trigger audit_row after insert or update or delete on public.teacher_absences for each row execute function public.audit_row('teacher_id', 'day');
    drop trigger if exists audit_row on public.substitutions;
    create trigger audit_row after insert or update or delete on public.substitutions for each row execute function public.audit_row('class_name', 'day', 'period');
  end if;
end $$;
