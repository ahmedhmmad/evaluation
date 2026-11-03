-- سيرة ذاتية منسّقة لكل موظف تُعرض برابط على الموقع (cv.html?t=…) من بطاقة المؤهلات المراجَعة.
-- الرابط مغلق حتى يفعّله المدير العام أو المدير من بطاقة الموظف، ويمكن إيقافه أو تغييره. وسائل التواصل وتاريخ الميلاد والعنوان
-- لا تظهر إلا إن اختيرت. شغّله بعد staff_profiles.sql. لا يغيّر أي بيانات موجودة.

alter table public.staff_profiles
  add column if not exists cv_token text unique,
  add column if not exists cv_public boolean not null default false,
  add column if not exists cv_contact boolean not null default false;

create or replace function public.staff_cv(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p staff_profiles; t teachers; d jsonb;
begin
  if coalesce(length(p_token), 0) < 20 then return null; end if;
  select * into p from staff_profiles where cv_token = p_token and cv_public and reviewed;
  if not found then return null; end if;
  select * into t from teachers where id = p.staff_id;
  d := p.data - 'unsure' - 'pages' - 'has';
  if not p.cv_contact then d := d - 'phone' - 'email' - 'address' - 'birth_date'; end if;
  return jsonb_build_object(
    'school', coalesce((select nullif(to_jsonb(st) ->> 'school_name', '') from settings st where st.id = 1), 'أكاديمية الركيزة الثالثة'),
    'name', t.name, 'job_title', coalesce(to_jsonb(t) ->> 'job_title', ''), 'subject', coalesce(to_jsonb(t) ->> 'subject', ''),
    'data', d, 'updated', p.updated_at);
end $$;
revoke all on function public.staff_cv(text) from public;
grant execute on function public.staff_cv(text) to anon, authenticated;
