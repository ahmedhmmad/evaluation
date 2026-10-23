-- الرواتب: «إعدادات الرواتب» و«حساب الرواتب».
--   payroll_setup: راتب كل موظف (من «بيانات العاملين») وقواعد الدوام، شهرًا بشهر. الشهر الذي لم تُحفظ له إعدادات
--                  يعتمد آخر شهر قبله حُفظت إعداداته (يُحسب ذلك في الصفحة).
--   payroll_runs:  الإضافات والخصومات اليدوية لكل شهر، وكشف الشهر كما اعتُمد (لا يتغير بعد الاعتماد بتعديل الدوام أو الرواتب).
--   payroll_access: من يصل إلى الرواتب غير المدير العام (حسابات المدير والمشرف العام): مشاهدة، أو تعديل.
-- المدير العام يرى ويعدّل دائمًا، وهو وحده يمنح الصلاحيات ويلغي اعتماد شهر.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql و staff_attendance.sql)، ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات موجودة.

create table if not exists public.payroll_setup (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  salaries jsonb not null default '{}'::jsonb,   -- { "<teacher_id>": 15000, ... }
  rules jsonb not null default '{}'::jsonb,      -- أيام العمل، التأخير المسموح، الإجازات في فترة، طريقة خصم التأخير، دوام المحفظين
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  can_edit boolean not null default false,
  granted_by text not null default '',
  granted_at timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  adj jsonb not null default '{}'::jsonb,        -- { "<teacher_id>": { "add": 500, "addNote": "...", "ded": 200, "dedNote": "..." } }
  rows jsonb,                                    -- كشف الشهر عند الاعتماد
  rules jsonb,
  approved_by text not null default '',
  approved_at timestamptz,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

-- تغيير راتب موظف خلال الشهر (نصف نصاب ثم نصاب كامل من تاريخ): { "<teacher_id>": { "from": "2026-11-10", "amount": 15000 } }
alter table public.payroll_setup add column if not exists changes jsonb not null default '{}'::jsonb;

-- إظهار سليبات شهر معتمد للموظفين في «دوامي وراتبي»: ممنوع افتراضيًا، ويُظهرها من له تعديل الرواتب
-- (المدير العام، والمدير والمشرف العام إن مُنحوا التعديل) بالدالة set_payroll_slips أدناه
alter table public.payroll_runs add column if not exists show_slip boolean not null default false;

-- صلاحية الحساب الحالي في الرواتب: 'edit' أو 'view' أو ''.
-- حساب «جهة مشرفة» (read_only، من outside_accounts.sql) مشاهدة فقط حتى لو مُنح التعديل
create or replace function public.payroll_level() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  ro boolean := false;
begin
  if public.my_role() = 'superadmin' then return 'edit'; end if;
  if public.my_role() <> 'manager' then return ''; end if;   -- المدير والمشرف العام (دوره manager)؛ لا المشرف التربوي
  if not exists (select 1 from public.payroll_access a where a.user_id = auth.uid()) then return ''; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_only') then
    execute 'select coalesce((select read_only from public.profiles where id = auth.uid()), false)' into ro;
  end if;
  if not ro and exists (select 1 from public.payroll_access a where a.user_id = auth.uid() and a.can_edit) then return 'edit'; end if;
  return 'view';
end;
$$;
revoke all on function public.payroll_level() from public, anon;
grant execute on function public.payroll_level() to authenticated;

alter table public.payroll_setup enable row level security;
alter table public.payroll_access enable row level security;
alter table public.payroll_runs enable row level security;
revoke all on public.payroll_setup, public.payroll_access, public.payroll_runs from anon;
grant select, insert, update, delete on public.payroll_setup, public.payroll_access, public.payroll_runs to authenticated;

drop policy if exists payroll_setup_admin on public.payroll_setup;
drop policy if exists payroll_setup_read on public.payroll_setup;
create policy payroll_setup_read on public.payroll_setup
  for select to authenticated using (public.payroll_level() <> '');
drop policy if exists payroll_setup_write on public.payroll_setup;
create policy payroll_setup_write on public.payroll_setup
  for all to authenticated using (public.payroll_level() = 'edit') with check (public.payroll_level() = 'edit');

drop policy if exists payroll_runs_read on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs
  for select to authenticated using (public.payroll_level() <> '');
-- التعديل: لمن له التعديل، والشهر المعتمد لا يُعدَّل إلا بإلغاء اعتماده، وهذا للمدير العام وحده
drop policy if exists payroll_runs_insert on public.payroll_runs;
create policy payroll_runs_insert on public.payroll_runs
  for insert to authenticated with check (public.payroll_level() = 'edit');
drop policy if exists payroll_runs_update on public.payroll_runs;
create policy payroll_runs_update on public.payroll_runs
  for update to authenticated using (public.payroll_level() = 'edit' and (status = 'draft' or public.my_role() = 'superadmin'))
  with check (public.payroll_level() = 'edit');
drop policy if exists payroll_runs_delete on public.payroll_runs;
create policy payroll_runs_delete on public.payroll_runs
  for delete to authenticated using (public.my_role() = 'superadmin');

drop policy if exists payroll_access_read on public.payroll_access;
create policy payroll_access_read on public.payroll_access
  for select to authenticated using (user_id = auth.uid() or public.my_role() = 'superadmin');
drop policy if exists payroll_access_write on public.payroll_access;
create policy payroll_access_write on public.payroll_access
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

create or replace function public.set_payroll_slips(p_month text, p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.payroll_level() <> 'edit' then raise exception 'لا تملك صلاحية تعديل الرواتب'; end if;
  update public.payroll_runs set show_slip = coalesce(p_show, false) where month = p_month and status = 'approved';
  if not found then raise exception 'رواتب هذا الشهر غير معتمدة'; end if;
end;
$$;
revoke all on function public.set_payroll_slips(text, boolean) from public, anon;
grant execute on function public.set_payroll_slips(text, boolean) to authenticated;

-- «حساب الرواتب» يقرأ «دوام الموظفين» ووقته الرسمي (المدير والمشرف يقرآنه أصلًا؛ هذا لمن أُعطي الرواتب)
do $$
begin
  if to_regclass('public.staff_attendance') is not null then
    drop policy if exists staff_attendance_payroll_read on public.staff_attendance;
    create policy staff_attendance_payroll_read on public.staff_attendance
      for select to authenticated using (public.payroll_level() <> '');
    drop policy if exists staff_hours_payroll_read on public.staff_hours;
    create policy staff_hours_payroll_read on public.staff_hours
      for select to authenticated using (public.payroll_level() <> '');
  end if;
end $$;

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.payroll_setup;
    create trigger audit_row after insert or update or delete on public.payroll_setup for each row execute function public.audit_row('month');
    drop trigger if exists audit_row on public.payroll_runs;
    create trigger audit_row after insert or update or delete on public.payroll_runs for each row execute function public.audit_row('month');
    drop trigger if exists audit_row on public.payroll_access;
    create trigger audit_row after insert or update or delete on public.payroll_access for each row execute function public.audit_row('user_id');
  end if;
end $$;
