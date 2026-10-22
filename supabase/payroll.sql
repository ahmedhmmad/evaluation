-- الرواتب ← إعدادات الرواتب: راتب كل موظف (من «بيانات العاملين») وقواعد الدوام، شهرًا بشهر.
-- الشهر الذي لم تُحفظ له إعدادات يعتمد آخر شهر قبله حُفظت إعداداته (يُحسب ذلك في الصفحة).
-- يقرؤه ويعدّله المدير العام وحده.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff.sql)، ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات موجودة.

create table if not exists public.payroll_setup (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  salaries jsonb not null default '{}'::jsonb,   -- { "<teacher_id>": 15000, ... }
  rules jsonb not null default '{}'::jsonb,      -- أيام وساعات التأخير المسموح بها، وأيام الإجازات في فترة العام الدراسي
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.payroll_setup enable row level security;
revoke all on public.payroll_setup from anon;
grant select, insert, update, delete on public.payroll_setup to authenticated;

drop policy if exists payroll_setup_admin on public.payroll_setup;
create policy payroll_setup_admin on public.payroll_setup
  for all to authenticated using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

-- سجل التعديلات (إن شُغّل supabase/audit_log.sql)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.payroll_setup;
    create trigger audit_row after insert or update or delete on public.payroll_setup for each row execute function public.audit_row('month');
  end if;
end $$;
