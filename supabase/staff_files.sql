-- ملفات العاملين (السير الذاتية، الشهادات، الخبرات، ...): الملفات نفسها في Cloudflare R2، وهنا سجل صغير لكل ملف فقط.
-- الرفع والفتح بروابط مؤقتة من دالة staff-files (مفاتيح R2 فيها لا في الصفحة). يرى الملفات ويديرها المدير العام والمدير.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.staff_files (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.teachers (id) on delete cascade,
  kind text not null default 'cv',       -- cv, cv_all (سيرة وملحقات), degree, experience, course, id, contract, other
  name text not null,                    -- اسم الملف الأصلي
  object_key text not null unique,       -- مساره في R2: staff/<staff_id>/<id>-<name>
  size bigint,
  mime text,
  note text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text
);
create index if not exists staff_files_staff on public.staff_files (staff_id);

alter table public.staff_files enable row level security;
revoke all on public.staff_files from anon;
grant select, insert, update, delete on public.staff_files to authenticated;
drop policy if exists staff_files_rw on public.staff_files;
create policy staff_files_rw on public.staff_files for all to authenticated
  using (public.my_role() in ('superadmin', 'manager'))
  with check (public.my_role() in ('superadmin', 'manager') and not coalesce(public.my_read_only(), false));
