-- Outside and test accounts.
-- 1) A staff record can be marked «ليس من العاملين» (a test account, or the body that supervises the school):
--    it keeps its login but never appears in staff attendance, evaluations, timetables, substitutes or staff transport.
-- 2) An account can be «جهة مشرفة (مشاهدة وتصدير فقط)»: the manager's role (it sees what the manager sees) with read_only set,
--    so it can write nothing at all, not even what the manager may edit (staff attendance and official hours).
--    This is enforced here, on every table, not only by hiding buttons on the page.
-- Run this file once in the Supabase SQL Editor, after schema.sql, manager.sql and staff_attendance.sql. Safe to re-run.
-- It does not change existing data. Tables added later: re-run this file so they get the same block.

alter table public.teachers add column if not exists not_staff boolean not null default false;
alter table public.profiles add column if not exists read_only boolean not null default false;

-- Only the superadmin changes profiles already (profiles_update in schema.sql), so nobody can lift their own read_only.

create or replace function public.my_read_only() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select read_only from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.my_read_only() from public, anon;
grant execute on function public.my_read_only() to authenticated;

-- A restrictive policy is added (AND) to whatever the table already allows: a read-only account can still read
-- what its role reads, and can never insert, update or delete. Functions that run as their owner (the bots, the
-- links) are not affected.
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists read_only_no_insert on public.%I', t);
    execute format('create policy read_only_no_insert on public.%I as restrictive for insert to authenticated with check (not public.my_read_only())', t);
    execute format('drop policy if exists read_only_no_update on public.%I', t);
    execute format('create policy read_only_no_update on public.%I as restrictive for update to authenticated using (not public.my_read_only()) with check (not public.my_read_only())', t);
    execute format('drop policy if exists read_only_no_delete on public.%I', t);
    execute format('create policy read_only_no_delete on public.%I as restrictive for delete to authenticated using (not public.my_read_only())', t);
  end loop;
end $$;
