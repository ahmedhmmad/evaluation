-- «دوامي وراتبي»: كل حساب مربوط بسجل في «بيانات العاملين» يرى دوامه هو فقط، شهرًا بشهر (الحضور والغياب والإجازات والتأخير
-- بحسب مجموعة دوامه)، وسليب راتبه للشهر المعتمد (الخصومات والإضافات والصافي). لا يرى دوام غيره ولا رواتبهم.
-- الحساب مربوط بسجله إن كان profiles.teacher_id له، أو teachers.user_id يشير إليه.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد staff_attendance.sql، ويُفضّل بعد staff_shifts.sql و payroll.sql)، ويمكن تشغيله مرة أخرى.

create or replace function public.my_staff_month(p_month text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid;
  tname text;
  h jsonb;
  shift jsonb;
  g jsonb;
  days jsonb := '[]'::jsonb;
  slip jsonb;
  rules jsonb;
begin
  select coalesce(p.teacher_id, (select t.id from public.teachers t where t.user_id = auth.uid() limit 1)) into tid
    from public.profiles p where p.id = auth.uid();
  if tid is null then return null; end if;
  select name into tname from public.teachers where id = tid;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('id', tid, 'name', tname);
  end if;

  -- دوامه: مجموعته إن كانت له، وإلا الوقت الرسمي
  if to_regclass('public.staff_hours') is not null then
    select to_jsonb(x) into h from public.staff_hours x where x.id = 1;
  end if;
  shift := jsonb_build_object('name', 'الوقت الرسمي', 'time_in', left(coalesce(h->>'time_in', '07:30'), 5), 'time_out', left(coalesce(h->>'time_out', '13:30'), 5));
  if h ? 'assign' and (h->'assign') ? tid::text then
    for g in select * from jsonb_array_elements(coalesce(h->'groups', '[]'::jsonb)) loop
      if g->>'id' = h->'assign'->>tid::text then
        shift := jsonb_build_object('name', g->>'name', 'time_in', g->>'time_in', 'time_out', g->>'time_out');
      end if;
    end loop;
  end if;

  if to_regclass('public.staff_attendance') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'status', a.status, 'time_in', left(a.time_in::text, 5), 'time_out', left(a.time_out::text, 5), 'note', a.note) order by a.day), '[]'::jsonb)
      into days from public.staff_attendance a
     where a.teacher_id = tid and to_char(a.day, 'YYYY-MM') = p_month;
  end if;

  -- سليبه من كشف الشهر المعتمد فقط
  if to_regclass('public.payroll_runs') is not null then
    execute 'select e, r.rules from public.payroll_runs r, jsonb_array_elements(coalesce(r.rows, ''[]''::jsonb)) e
              where r.month = $1 and r.status = ''approved'' and e->>''id'' = $2 limit 1'
      into slip, rules using p_month, tid::text;
  end if;

  return jsonb_build_object('id', tid, 'name', tname, 'month', p_month, 'shift', shift, 'days', days, 'slip', slip,
    'rules', case when rules is null then null else jsonb_build_object('work_days', rules->'work_days', 'signer_title', rules->'signer_title', 'signer_name', rules->'signer_name') end);
end;
$$;
revoke all on function public.my_staff_month(text) from public, anon;
grant execute on function public.my_staff_month(text) to authenticated;
