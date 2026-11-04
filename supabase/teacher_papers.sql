-- أوراق العمل والاختبارات: يُعدّها المعلم في الموقع (المحتوى فقط) وتُطبع بقالب الأكاديمية الرسمي.
-- كل معلم يرى أوراقه، ويختار نشر الورقة (public) فيراها زملاؤه، أو إبقاءها خاصة (private).
-- المدير العام والمدير والمشرف التربوي يرون كل الأوراق؛ والمشرف التربوي يعتمد أو يعيد للتعديل حين يُفعَّل الاعتماد.
-- وفيه أيضًا my_staff_cv(): السيرة الذاتية للمعلم نفسه في صفحة «دوامي وراتبي».
-- شغّل هذا الملف مرة في محرر SQL في Supabase (بعد staff_self.sql، ويُفضّل بعد staff_cv.sql). لا يغيّر أي بيانات موجودة.

-- سجل العامل المربوط بالحساب الحالي (كما في my_staff_month)
create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p.teacher_id, (select t.id from teachers t where t.user_id = auth.uid() limit 1))
  from profiles p where p.id = auth.uid()
$$;
grant execute on function public.my_teacher_id() to authenticated;

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  kind text not null default 'worksheet' check (kind in ('worksheet', 'quiz', 'monthly', 'midterm', 'final')),
  subject text not null default '',
  class_name text not null default '',
  lesson text not null default '',          -- الدرس أو الوحدة
  term text not null default '',            -- الفصل الدراسي
  paper_date date,
  duration text not null default '',        -- زمن الاختبار
  instructions text not null default '',
  items jsonb not null default '[]',        -- [{title, points, body, lines}] الأنشطة أو الأسئلة بالترتيب
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists papers_teacher on public.papers (teacher_id, updated_at desc);

-- إعداد واحد: هل الاعتماد مفعَّل (معطَّل حتى يفعّله المدير العام)
create table if not exists public.paper_settings (
  id int primary key default 1 check (id = 1),
  review_enabled boolean not null default false
);
insert into public.paper_settings (id) values (1) on conflict (id) do nothing;

alter table public.papers enable row level security;
alter table public.paper_settings enable row level security;
revoke all on public.papers, public.paper_settings from anon;
grant select, insert, update, delete on public.papers to authenticated;
grant select, update on public.paper_settings to authenticated;

drop policy if exists papers_read on public.papers;
create policy papers_read on public.papers for select to authenticated using (
  teacher_id = public.my_teacher_id()
  or (visibility = 'public' and public.my_teacher_id() is not null)
  or public.my_role() in ('superadmin', 'manager', 'supervisor'));

-- المعلم يكتب أوراقه هو؛ والمدير العام كل الأوراق؛ والمشرف التربوي يعدّل حالة المراجعة (يمنع الـ trigger غير ذلك)
drop policy if exists papers_insert on public.papers;
create policy papers_insert on public.papers for insert to authenticated with check (
  (teacher_id = public.my_teacher_id() or public.my_role() = 'superadmin') and not coalesce(public.my_read_only(), false));
drop policy if exists papers_update on public.papers;
create policy papers_update on public.papers for update to authenticated
  using (teacher_id = public.my_teacher_id() or public.my_role() in ('superadmin', 'supervisor'))
  with check (not coalesce(public.my_read_only(), false));
drop policy if exists papers_delete on public.papers;
create policy papers_delete on public.papers for delete to authenticated using (
  (teacher_id = public.my_teacher_id() and status <> 'approved') or public.my_role() = 'superadmin');

drop policy if exists paper_settings_read on public.paper_settings;
create policy paper_settings_read on public.paper_settings for select to authenticated using (true);
drop policy if exists paper_settings_write on public.paper_settings;
create policy paper_settings_write on public.paper_settings for update to authenticated using (public.my_role() = 'superadmin');

-- الاعتماد والإعادة للمشرف التربوي والمدير العام فقط؛ والمعلم لا يعتمد ورقته. المشرف لا يغيّر محتوى ورقة غيره.
-- تعديل المعلم لورقة معتمدة أو معادة يعيدها مسودة.
create or replace function public.papers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare reviewer boolean := public.my_role() in ('superadmin', 'supervisor'); keep papers;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if not reviewer then new.status := case when new.status = 'submitted' then 'submitted' else 'draft' end; new.review_note := null; new.reviewed_by := null; new.reviewed_at := null; end if;
    return new;
  end if;
  if new.status in ('approved', 'returned') and new.status is distinct from old.status and not reviewer then
    raise exception 'الاعتماد للمشرف التربوي';
  end if;
  if public.my_role() = 'supervisor' and old.teacher_id is distinct from public.my_teacher_id() then
    -- المشرف على ورقة غيره: الحالة والملاحظة فقط
    keep := old;
    keep.status := new.status; keep.review_note := new.review_note; keep.reviewed_by := new.reviewed_by; keep.reviewed_at := new.reviewed_at; keep.updated_at := now();
    return keep;
  end if;
  if not reviewer and old.status in ('approved', 'returned') and (new.items is distinct from old.items or new.instructions is distinct from old.instructions) then
    new.status := 'draft';
  end if;
  return new;
end $$;
drop trigger if exists papers_guard on public.papers;
create trigger papers_guard before insert or update on public.papers for each row execute function public.papers_guard();

-- السيرة الذاتية للعامل نفسه: رابطها إن كان مفعّلًا، وبطاقة مؤهلاته المعتمدة
create or replace function public.my_staff_cv() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.my_teacher_id(); r jsonb;
begin
  if tid is null or to_regclass('public.staff_profiles') is null then return null; end if;
  select to_jsonb(p) into r from staff_profiles p where p.staff_id = tid and p.reviewed;
  if r is null then return null; end if;
  return jsonb_build_object('token', case when coalesce((r ->> 'cv_public')::boolean, false) then r ->> 'cv_token' end,
    'data', (r -> 'data') - 'unsure' - 'pages');
end $$;
grant execute on function public.my_staff_cv() to authenticated;
