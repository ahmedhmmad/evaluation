-- Approval of supervisory visit reports by the manager (مدير الأكاديمية).
-- The supervisor writes and prints the report; it prints with «بانتظار اعتماد المدير» until the manager (or the superadmin) approves it,
-- then prints as approved with the approver's name and date. Editing an approved report cancels its approval (the app clears it).
-- Run this file once in the Supabase SQL Editor, after visits.sql and manager.sql. It does not change existing data.

alter table public.visits add column if not exists approved_by text not null default '';
alter table public.visits add column if not exists approved_at timestamptz;

-- The manager has no write access to visits; approval goes through this function only.
create or replace function public.set_visit_approval(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare who text;
begin
  if public.my_role() not in ('manager', 'superadmin') then raise exception 'غير مسموح'; end if;
  if p_approve and public.my_role() = 'manager' and exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce((to_jsonb(p) ->> 'read_only')::boolean, false)) then
    raise exception 'غير مسموح';
  end if;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();
  update public.visits
     set approved_by = case when p_approve then coalesce(who, '') else '' end,
         approved_at = case when p_approve then now() else null end
   where id = p_id;
end $$;
revoke all on function public.set_visit_approval(uuid, boolean) from public, anon;
grant execute on function public.set_visit_approval(uuid, boolean) to authenticated;
