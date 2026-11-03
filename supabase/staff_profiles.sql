-- بطاقة مؤهلات موحّدة لكل موظف، مستخرجة من ملفاته (السيرة الذاتية والشهادات) بدالة read-staff-cv ثم مراجَعة في الموقع.
-- يراها ويعدّلها المدير العام والمدير. شغّله بعد staff_files.sql. لا يغيّر أي بيانات موجودة.

create table if not exists public.staff_profiles (
  staff_id uuid primary key references public.teachers (id) on delete cascade,
  data jsonb not null default '{}',     -- المؤهل، التخصص، الجامعة، سنة التخرج، الخبرات، الدورات، اللغات ... (انظر index.html: SP_FIELDS)
  files jsonb not null default '[]',    -- الملفات التي قُرئت ووصف صفحاتها
  model text,
  read_at timestamptz,
  reviewed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon;
grant select, insert, update, delete on public.staff_profiles to authenticated;
drop policy if exists staff_profiles_rw on public.staff_profiles;
create policy staff_profiles_rw on public.staff_profiles for all to authenticated
  using (public.my_role() in ('superadmin', 'manager'))
  with check (public.my_role() in ('superadmin', 'manager') and not coalesce(public.my_read_only(), false));
