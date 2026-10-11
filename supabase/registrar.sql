-- "Student registrar" role: staff who register students at the desk, several at once.
-- A registrar can read, add and edit student records and choose a student's assembly point.
-- A registrar cannot delete students, see transport payments, teacher evaluations or settings screens.
-- Run this file once in the Supabase SQL Editor, after the other scripts.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'superadmin'));

-- Students: read, add, edit (no delete).
drop policy if exists students_registrar_select on public.students;
create policy students_registrar_select on public.students
  for select to authenticated
  using (public.my_role() = 'registrar');

drop policy if exists students_registrar_insert on public.students;
create policy students_registrar_insert on public.students
  for insert to authenticated
  with check (public.my_role() = 'registrar');

drop policy if exists students_registrar_update on public.students;
create policy students_registrar_update on public.students
  for update to authenticated
  using (public.my_role() = 'registrar')
  with check (public.my_role() = 'registrar');

-- Transport: see the assembly points, and put a student in one (or take them out) while registering.
drop policy if exists transport_groups_registrar on public.transport_groups;
create policy transport_groups_registrar on public.transport_groups
  for select to authenticated
  using (public.my_role() = 'registrar');

drop policy if exists transport_members_registrar on public.transport_members;
create policy transport_members_registrar on public.transport_members
  for all to authenticated
  using (public.my_role() = 'registrar')
  with check (public.my_role() = 'registrar');

-- Settings (school name, classes): readable by registrars too.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (public.my_role() in ('viewer', 'registrar', 'supervisor', 'superadmin'));

-- Teacher evaluation results are not for registrars.
create or replace function public.get_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r text := public.my_role();
  s public.settings;
  own uuid;
begin
  if r is null or r in ('pending', 'registrar') then
    return jsonb_build_object('settings', null, 'results', '[]'::jsonb);
  end if;

  select * into s from public.settings where id = 1;
  if r = 'teacher' then
    select teacher_id into own from public.profiles where id = auth.uid();
  end if;

  return jsonb_build_object(
    'settings', to_jsonb(s),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'subject', t.subject,
        'published_at', t.published_at,
        'total', case when s.show_totals then (
          select coalesce(sum(e.value::int), 0) from jsonb_each_text(t.ratings) e
        ) end,
        'ratings', case when s.show_items then t.ratings end,
        'notes', case when s.show_notes then t.notes end,
        'approver_notes', case when s.show_approver_notes then t.approver_notes end
      ) order by t.name)
      from public.teachers t
      where t.status = 'published' and t.visible
        and (r <> 'teacher' or t.id = own)
    ), '[]'::jsonb)
  );
end;
$$;
