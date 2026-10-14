-- "Manager" role: sees every screen and every record, and changes nothing.
-- Read-only policies on each table; no insert/update/delete policy is given to this role, so the database
-- refuses any change it sends. Teacher absence links and their bot key stay with the superadmin only.
-- Run this file once in the Supabase SQL Editor, after the other scripts. It does not change existing data.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'viewer', 'teacher', 'registrar', 'supervisor', 'manager', 'superadmin'));

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'settings', 'teachers', 'visits', 'statements', 'students',
    'transport_groups', 'transport_members', 'transport_payments', 'transport_voided', 'transport_refunds', 'attendance']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_manager_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = ''manager'')', t || '_manager_read', t);
    end if;
  end loop;
end $$;
