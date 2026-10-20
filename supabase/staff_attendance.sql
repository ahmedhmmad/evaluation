-- دوام الموظفين: حضور كل العاملين (من «بيانات العاملين») وانصرافهم بالوقت، يومًا بيوم.
-- يسجّله المدير العام والمدير؛ ويقرؤه المشرف التربوي أيضًا (ليرى غياب المعلمين في شاشة الاحتياط).
-- الوقت الرسمي للحضور والانصراف واحد للجميع، في staff_hours، وبه يُحسب التأخير والانصراف المبكر.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql)، ويمكن تشغيله مرة أخرى بعد أي تحديث له. لا يغيّر أي بيانات موجودة.

-- مدة العمل: يُحسب دوام الموظف من «تاريخ التعيين» (hire_date، من teacher_accounts.sql) إلى «تاريخ انتهاء العقد» (آخر يوم عمل)، إن وُجدا
alter table public.teachers
  add column if not exists contract_end date;

create table if not exists public.staff_attendance (
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  day date not null,
  status text not null default 'present' check (status in ('present', 'absent', 'leave', 'mission')),   -- حاضر، غائب، إجازة، مأمورية
  time_in time,
  time_out time,
  note text not null default '',
  recorded_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (teacher_id, day)
);
create index if not exists staff_attendance_day_idx on public.staff_attendance (day);

create table if not exists public.staff_hours (
  id int primary key default 1 check (id = 1),
  time_in time not null default '07:30',
  time_out time not null default '13:30',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.staff_hours (id) values (1) on conflict (id) do nothing;

alter table public.staff_attendance enable row level security;
alter table public.staff_hours enable row level security;
revoke all on public.staff_attendance, public.staff_hours from anon;
grant select, insert, update, delete on public.staff_attendance to authenticated;
grant select, update on public.staff_hours to authenticated;

drop policy if exists staff_attendance_read on public.staff_attendance;
create policy staff_attendance_read on public.staff_attendance
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists staff_attendance_write on public.staff_attendance;
create policy staff_attendance_write on public.staff_attendance
  for all to authenticated using (public.my_role() in ('superadmin', 'manager')) with check (public.my_role() in ('superadmin', 'manager'));

drop policy if exists staff_hours_read on public.staff_hours;
create policy staff_hours_read on public.staff_hours
  for select to authenticated using (public.my_role() in ('superadmin', 'manager', 'supervisor'));
drop policy if exists staff_hours_write on public.staff_hours;
create policy staff_hours_write on public.staff_hours
  for update to authenticated using (public.my_role() in ('superadmin', 'manager')) with check (public.my_role() in ('superadmin', 'manager'));

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.staff_attendance;
    create trigger audit_row after insert or update or delete on public.staff_attendance for each row execute function public.audit_row('teacher_id', 'day');
    drop trigger if exists audit_row on public.staff_hours;
    create trigger audit_row after insert or update or delete on public.staff_hours for each row execute function public.audit_row('id');
  end if;
end $$;
