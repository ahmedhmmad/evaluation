-- التنبيهات المكتوبة للموظفين («دوام الموظفين» ← «الكتب» ← «كتاب تنبيه» ← «حفظ في ملف الموظف»).
-- يُحفظ نص التنبيه نفسه، فيظهر في بطاقة الموظف ويُعاد طباعته كما صدر. يراها ويديرها المدير العام والمدير.
-- شغّل هذا الملف مرة في محرر SQL في Supabase.

create table if not exists public.staff_warnings (
  id uuid primary key default gen_random_uuid(),
  no serial,
  staff_id uuid not null references public.teachers (id) on delete cascade,
  letter_date date not null default current_date,
  subject text not null default 'تنبيه',
  salutation text not null default '',
  body text not null default '',
  supervisor text not null default '',
  principal text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists staff_warnings_staff on public.staff_warnings (staff_id);

alter table public.staff_warnings enable row level security;
revoke all on public.staff_warnings from anon;
grant select, insert, update, delete on public.staff_warnings to authenticated;
drop policy if exists staff_warnings_rw on public.staff_warnings;
create policy staff_warnings_rw on public.staff_warnings for all to authenticated
  using (public.my_role() in ('superadmin', 'manager'))
  with check (public.my_role() in ('superadmin', 'manager') and not coalesce(public.my_read_only(), false));

-- يُسجَّل في سجل التعديلات إن كان مُفعّلًا (supabase/audit_log.sql)
do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_row on public.staff_warnings;
    create trigger audit_row after insert or update or delete on public.staff_warnings for each row execute function public.audit_row('no');
  end if;
end $$;
