-- Teacher evaluation: database schema for Supabase.
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> Run.

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending'
    check (role in ('pending', 'viewer', 'supervisor', 'superadmin')),
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  status text not null default 'new'
    check (status in ('new', 'edit', 'review', 'approved', 'published')),
  ratings jsonb not null default '{}'::jsonb,
  notes text not null default '',
  approver_notes text not null default '',
  approved_at timestamptz,
  published_at timestamptz,
  visible boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Single row: what viewer accounts are allowed to see.
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  show_totals boolean not null default true,
  show_items boolean not null default true,
  show_notes boolean not null default false,
  show_approver_notes boolean not null default false
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- Helpers ----------

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Every new sign-up gets a profile with role 'pending' (no access until a superadmin assigns a role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the superadmin may show/hide an evaluation from viewers.
create or replace function public.guard_teacher_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visible is distinct from old.visible
     and coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'Only the superadmin can change visibility';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists teachers_guard_visibility on public.teachers;
create trigger teachers_guard_visibility
  before update on public.teachers
  for each row execute function public.guard_teacher_visibility();

-- What viewers get: published + visible evaluations, with hidden parts removed on the server.
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
begin
  if r is null or r = 'pending' then
    return jsonb_build_object('settings', null, 'results', '[]'::jsonb);
  end if;

  select * into s from public.settings where id = 1;

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
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------- Permissions ----------

alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.settings enable row level security;

revoke all on public.profiles, public.teachers, public.settings from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.teachers to authenticated;
grant select, update on public.settings to authenticated;

revoke execute on function public.get_results() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.get_results() to authenticated;
grant execute on function public.my_role() to authenticated;

-- Profiles: each user reads their own; the superadmin reads all and assigns roles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.my_role() = 'superadmin');

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');

-- Teachers and evaluations: supervisors and the superadmin only.
-- Viewers never read this table directly; they go through get_results().
drop policy if exists teachers_staff on public.teachers;
create policy teachers_staff on public.teachers
  for all to authenticated
  using (public.my_role() in ('supervisor', 'superadmin'))
  with check (public.my_role() in ('supervisor', 'superadmin'));

-- Settings: readable by active accounts, changed by the superadmin only.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (public.my_role() in ('viewer', 'supervisor', 'superadmin'));

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using (public.my_role() = 'superadmin')
  with check (public.my_role() = 'superadmin');

-- ---------- First superadmin ----------
-- After you sign up on the page, run this once with your own email:
--
--   update public.profiles set role = 'superadmin' where email = 'you@example.com';
