-- مزوّد قراءة كشف الدوام المصوَّر (read-staff-sheet): DeepInfra أو OpenRouter، يختاره المدير العام من «الإعدادات والمستخدمون».
-- يُحفظ في bot_settings (paper_files.sql) بالمفتاح staff_sheet_provider، ونموذج OpenRouter الاختياري بالمفتاح staff_sheet_or_model.
-- يخص كشف دوام الموظفين وحده؛ قراءة الاستمارات والسير الذاتية تبقى على DeepInfra. آمن لإعادة التشغيل.
-- يعتمد على: paper_files.sql (bot_settings)، schema.sql (my_role).

-- تقرؤه خدمة read-staff-sheet (بجلسة المستخدم أو بلا جلسة من بوت n8n)، فلا يكشف إلا اسم المزوّد والنموذج
create or replace function public.staff_sheet_provider() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'provider', coalesce((select value from bot_settings where key = 'staff_sheet_provider'), 'deepinfra'),
    'model', coalesce((select value from bot_settings where key = 'staff_sheet_or_model'), ''))
$$;

create or replace function public.set_staff_sheet_provider(p_provider text, p_model text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() is distinct from 'superadmin' then raise exception 'forbidden'; end if;
  if p_provider not in ('deepinfra', 'openrouter') then raise exception 'unknown provider'; end if;
  if coalesce(p_model, '') <> '' and p_model !~ '^[A-Za-z0-9][A-Za-z0-9._/:-]{2,99}$' then raise exception 'invalid model'; end if;
  insert into bot_settings (key, value, updated_at) values ('staff_sheet_provider', p_provider, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into bot_settings (key, value, updated_at) values ('staff_sheet_or_model', coalesce(p_model, ''), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function public.staff_sheet_provider() from public;
revoke all on function public.set_staff_sheet_provider(text, text) from public, anon;
grant execute on function public.staff_sheet_provider() to anon, authenticated;
grant execute on function public.set_staff_sheet_provider(text, text) to authenticated;
