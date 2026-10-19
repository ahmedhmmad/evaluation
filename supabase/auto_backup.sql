-- النسخ الاحتياطي التلقائي: n8n يطلب كل ليلة نسخة كاملة من القاعدة ويحفظها في Google Drive (n8n/auto-backup.json).
-- النسخة بنفس صيغة ملف «تنزيل نسخة احتياطية» في البرنامج، فتُستعاد من الشاشة نفسها.
-- الطلب يحتاج مفتاح النسخ (غير مفتاح بوت الغياب)؛ يراه المدير العام وحده في «الإعدادات والمستخدمون» ليضعه في n8n.
-- لا تدخل النسخة الأسرار: كلمة المرور الافتراضية، روابط الغياب السرية، مفتاح البوت، ولا سجل التعديلات.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.backup_status (
  id int primary key default 1 check (id = 1),
  backup_key text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_at timestamptz,          -- آخر نسخة حُفظت فعلًا في Drive
  last_file text not null default '',
  last_rows int not null default 0
);
insert into public.backup_status (id) values (1) on conflict (id) do nothing;

alter table public.backup_status enable row level security;
revoke all on public.backup_status from anon;
grant select on public.backup_status to authenticated;
drop policy if exists backup_status_admin on public.backup_status;
create policy backup_status_admin on public.backup_status
  for select to authenticated using (public.my_role() = 'superadmin');

-- النسخة كاملة. الجداول بنفس الترتيب والأسماء التي يستعيدها البرنامج (BACKUP_TABLES في index.html)
create or replace function public.backup_dump(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t text;
  rows jsonb;
  tables jsonb := '{}'::jsonb;
  cfg jsonb;
begin
  if p_key is null or p_key <> (select backup_key from backup_status where id = 1) then
    raise exception 'مفتاح النسخ غير صحيح';
  end if;
  foreach t in array array['teachers', 'visits', 'statements', 'students', 'transport_groups', 'transport_members', 'transport_payments',
      'transport_voided', 'transport_refunds', 'transport_topups', 'attendance', 'timetable_config', 'timetable_sessions', 'timetable_proposals', 'teacher_absences', 'substitutions'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    tables := tables || jsonb_build_object(t, rows);
  end loop;
  select to_jsonb(s) into cfg from settings s where id = 1;
  return jsonb_build_object('app', 'third-pillar-backup', 'version', 1, 'auto', true, 'created_at', now(),
    'school', coalesce(nullif(cfg ->> 'school_name', ''), 'أكاديمية الركيزة الثالثة'), 'settings', cfg, 'tables', tables);
end $$;

-- يستدعيها n8n بعد حفظ الملف في Drive، فيظهر في البرنامج وقت آخر نسخة ناجحة
create or replace function public.backup_done(p_key text, p_file text, p_rows int default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or p_key <> (select backup_key from backup_status where id = 1) then
    raise exception 'مفتاح النسخ غير صحيح';
  end if;
  update backup_status set last_at = now(), last_file = coalesce(p_file, ''), last_rows = coalesce(p_rows, 0) where id = 1;
end $$;

-- المدير العام يولّد مفتاحًا جديدًا إن تسرّب القديم (ثم يضعه في n8n)
create or replace function public.backup_new_key() returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'للمدير العام فقط'; end if;
  update backup_status set backup_key = k where id = 1;
  return k;
end $$;

revoke all on function public.backup_dump(text), public.backup_done(text, text, int), public.backup_new_key() from public;
grant execute on function public.backup_dump(text), public.backup_done(text, text, int) to anon, authenticated;
grant execute on function public.backup_new_key() to authenticated;
