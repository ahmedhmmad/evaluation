-- دورات المواصلات: حساب الدورة (بدايتها ونهايتها وموعد سدادها ورسومها) في القاعدة، مطابقًا لـ cycleOf() في index.html.
-- الدورة تُعرف بشهر بدايتها ('2026-11')، والإعداد في settings.classes.cycles = { startDay, graceDays, over: { 'YYYY-MM': { from, to, due, first, next } } }.
-- بلا إعداد: الدورة هي الشهر الميلادي، وموعد السداد يوم «آخر يوم للسداد» القديم منه.
-- تستعملها دوال تطبيق الموبايل (api.sql) ورابط ولي الأمر (parent_links.sql).
-- شغّل هذا الملف في محرر SQL، ثم أعد تشغيل parent_links.sql و api.sql. لا يغيّر أي بيانات.

create or replace function public.transport_num(p jsonb, p_default numeric) returns numeric
language sql immutable as $$
  select case when p is null or jsonb_typeof(p) = 'null' then p_default
              when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then btrim(p #>> '{}')::numeric
              else p_default end
$$;

create or replace function public.transport_iso(p jsonb) returns date
language sql immutable as $$
  select case when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then (p #>> '{}')::date end
$$;

-- '2026-11' + n أشهر
create or replace function public.transport_shift(p_key text, p_n int) returns text
language sql immutable as $$ select to_char((p_key || '-01')::date + make_interval(months => p_n), 'YYYY-MM') $$;

create or replace function public.transport_cycle(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb; f jsonb; cy jsonb; over jsonb; o jsonb; p jsonb; nx jsonb;
  due_day int; sd int; gd int; v numeric;
  frm date; nfrom date; t date; nkey text := public.transport_shift(p_key, 1);
begin
  if p_key !~ '^\d{4}-\d{2}$' then raise exception 'الدورة بصيغة YYYY-MM'; end if;
  select case when jsonb_typeof(s.classes) = 'object' then s.classes end into c from settings s where s.id = 1;
  f := coalesce(c -> 'fees', '{}'::jsonb);
  cy := case when jsonb_typeof(c -> 'cycles') = 'object' then c -> 'cycles' else '{}'::jsonb end;
  over := case when jsonb_typeof(cy -> 'over') = 'object' then cy -> 'over' else '{}'::jsonb end;
  o := coalesce(over -> p_key, '{}'::jsonb);
  p := coalesce(over -> public.transport_shift(p_key, -1), '{}'::jsonb);
  nx := coalesce(over -> nkey, '{}'::jsonb);

  v := public.transport_num(f -> 'dueDay', null);
  due_day := case when v between 1 and 28 then round(v) else 5 end;
  v := public.transport_num(cy -> 'startDay', null);
  sd := case when v between 1 and 28 then round(v) else 1 end;
  v := public.transport_num(cy -> 'graceDays', null);
  gd := case when v between 0 and 27 then round(v) else due_day - 1 end;

  frm := coalesce(public.transport_iso(o -> 'from'), public.transport_iso(p -> 'to') + 1, (p_key || '-' || lpad(sd::text, 2, '0'))::date);
  nfrom := coalesce(public.transport_iso(nx -> 'from'), public.transport_iso(o -> 'to') + 1, (nkey || '-' || lpad(sd::text, 2, '0'))::date);
  t := coalesce(public.transport_iso(o -> 'to'), nfrom - 1);

  return jsonb_build_object('key', p_key, 'from', frm, 'to', t,
    'due', coalesce(public.transport_iso(o -> 'due'), frm + gd),
    'first', public.transport_num(o -> 'first', public.transport_num(f -> 'first', 700)),
    'next', public.transport_num(o -> 'next', public.transport_num(f -> 'next', 600)),
    'custom', o <> '{}'::jsonb);
end $$;

-- الدورة التي يقع فيها اليوم (شهر بدايتها)
create or replace function public.transport_current_cycle(p_day date default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date); k text := to_char(d, 'YYYY-MM'); c jsonb; i int;
begin
  for i in 1 .. 3 loop
    c := public.transport_cycle(k);
    if d < (c ->> 'from')::date then k := public.transport_shift(k, -1);
    elsif d > (c ->> 'to')::date then k := public.transport_shift(k, 1);
    else exit; end if;
  end loop;
  return k;
end $$;

-- تُستدعى من داخل الدوال الأخرى فقط
revoke all on function public.transport_num(jsonb, numeric), public.transport_iso(jsonb), public.transport_shift(text, int),
  public.transport_cycle(text), public.transport_current_cycle(date) from public, anon, authenticated;
