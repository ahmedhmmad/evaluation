-- التوقيع الإلكتروني للأوراق الرسمية، مع حماية من التزوير.
-- كل صاحب توقيع (المدير، المشرف، ...) يرفع صورة توقيعه، ولا يراها غيره ولا مدير النظام إلا عند التوقيع.
-- التوقيع على ورقة: صاحبه بنفسه، أو مدير النظام نيابة عنه؛ وغيرهما يرسل «طلب توقيع» يعتمده صاحب التوقيع.
-- كل ورقة موقّعة تُحفظ هنا برقم ونصّها وبصمتها (SHA-256)، وتُطبع برمز QR يفتح verify.html فيُعرض نصها الأصلي:
-- أي تعديل في الورقة المطبوعة يظهر بالمقارنة، والورقة الملغاة تظهر ملغاة.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر أي بيانات موجودة.

create table if not exists public.signatures (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  title text not null default '',          -- الصفة: مدير/ة الأكاديمية، المشرف التربوي، ...
  image text not null,                     -- صورة PNG (data URL) بخلفية شفافة
  updated_at timestamptz not null default now()
);

create table if not exists public.sign_requests (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null default auth.uid(),
  requester_name text not null default '',
  signer_id uuid not null references public.signatures (user_id) on delete cascade,
  title text not null default '',
  html text not null,                      -- الورقة كما بُنيت للطباعة
  meta jsonb not null default '{}',        -- تخطيطها (أفقي، العرض، ...)
  body text not null default '',
  hash text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  code text,
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists sign_requests_signer on public.sign_requests (signer_id, status);

create table if not exists public.signed_docs (
  code text primary key,
  title text not null default '',
  body text not null default '',
  hash text not null default '',
  signer_id uuid,
  signer_name text not null default '',
  signer_title text not null default '',
  signed_by uuid,
  signed_by_name text not null default '',
  request_id uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);

alter table public.signatures enable row level security;
alter table public.sign_requests enable row level security;
alter table public.signed_docs enable row level security;
revoke all on public.signatures, public.sign_requests, public.signed_docs from anon;
grant select, insert, update, delete on public.signatures to authenticated;
grant select, insert, delete on public.sign_requests to authenticated;
grant select on public.signed_docs to authenticated;

drop policy if exists sig_own on public.signatures;
create policy sig_own on public.signatures for all to authenticated
  using (user_id = auth.uid() or public.my_role() = 'superadmin')
  with check (user_id = auth.uid() or public.my_role() = 'superadmin');

drop policy if exists sreq_read on public.sign_requests;
create policy sreq_read on public.sign_requests for select to authenticated
  using (requester = auth.uid() or signer_id = auth.uid() or public.my_role() = 'superadmin');
drop policy if exists sreq_insert on public.sign_requests;
create policy sreq_insert on public.sign_requests for insert to authenticated
  with check (requester = auth.uid() and coalesce(public.my_role(), 'pending') <> 'pending' and status = 'pending' and code is null);
drop policy if exists sreq_delete on public.sign_requests;
create policy sreq_delete on public.sign_requests for delete to authenticated
  using (requester = auth.uid() and status = 'pending');

drop policy if exists sdoc_read on public.signed_docs;
create policy sdoc_read on public.signed_docs for select to authenticated
  using (signer_id = auth.uid() or signed_by = auth.uid() or public.my_role() = 'superadmin');

-- أصحاب التوقيعات (بلا الصورة) لقائمة «طلب توقيع من»
create or replace function public.sig_signers() returns table (user_id uuid, name text, title text)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.name, s.title from signatures s where coalesce(public.my_role(), 'pending') <> 'pending' order by s.title, s.name
$$;
grant execute on function public.sig_signers() to authenticated;

-- التوقيع: صاحب التوقيع أو مدير النظام. مع p_request يُوقَّع طلب قائم (بنصه هو لا بنص يرسله المتصل)
create or replace function public.sign_doc(p_signer uuid, p_title text, p_body text, p_hash text, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s signatures; rq sign_requests; c text; me text;
begin
  if p_signer is distinct from auth.uid() and coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'التوقيع لصاحبه أو لمدير النظام فقط'; end if;
  select * into s from signatures where user_id = p_signer;
  if s.user_id is null then raise exception 'لم يُرفع توقيع لهذا الحساب'; end if;
  select coalesce(nullif(full_name, ''), email, '') into me from profiles where id = auth.uid();
  if p_request is not null then
    select * into rq from sign_requests where id = p_request for update;
    if rq.id is null or rq.status <> 'pending' or rq.signer_id <> p_signer then raise exception 'الطلب غير موجود أو بُتّ فيه'; end if;
    p_title := rq.title; p_body := rq.body; p_hash := rq.hash;
  end if;
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from signed_docs where code = c);
  end loop;
  insert into signed_docs (code, title, body, hash, signer_id, signer_name, signer_title, signed_by, signed_by_name, request_id)
  values (c, left(coalesce(p_title, ''), 300), left(coalesce(p_body, ''), 20000), coalesce(p_hash, ''), s.user_id, s.name, s.title, auth.uid(), coalesce(me, ''), p_request);
  if p_request is not null then
    update sign_requests set status = 'approved', code = c, decided_at = now() where id = p_request;
    return jsonb_build_object('code', c);
  end if;
  return jsonb_build_object('code', c, 'image', s.image, 'name', s.name, 'title', s.title, 'at', now());
end $$;
grant execute on function public.sign_doc(uuid, text, text, text, uuid) to authenticated;

create or replace function public.sig_reject(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update sign_requests set status = 'rejected', note = left(coalesce(p_note, ''), 500), decided_at = now()
  where id = p_request and status = 'pending' and (signer_id = auth.uid() or public.my_role() = 'superadmin');
  if not found then raise exception 'الطلب غير موجود أو بُتّ فيه'; end if;
end $$;
grant execute on function public.sig_reject(uuid, text) to authenticated;

-- طباعة طلب معتمد: لصاحب الطلب (أو صاحب التوقيع أو مدير النظام)، ومعه صورة التوقيع
create or replace function public.sig_request_print(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rq sign_requests; d signed_docs; s signatures;
begin
  select * into rq from sign_requests where id = p_id;
  if rq.id is null or rq.status <> 'approved' then raise exception 'الطلب لم يُعتمد'; end if;
  if rq.requester <> auth.uid() and rq.signer_id <> auth.uid() and coalesce(public.my_role(), '') <> 'superadmin' then raise exception 'غير مسموح'; end if;
  select * into d from signed_docs where code = rq.code;
  if d.revoked_at is not null then raise exception 'أُلغيت هذه الورقة'; end if;
  select * into s from signatures where user_id = rq.signer_id;
  return jsonb_build_object('code', d.code, 'image', s.image, 'name', d.signer_name, 'title', d.signer_title, 'at', d.created_at, 'html', rq.html, 'meta', rq.meta);
end $$;
grant execute on function public.sig_request_print(uuid) to authenticated;

create or replace function public.sig_revoke(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update signed_docs set revoked_at = now(), revoked_by = (select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid())
  where code = p_code and revoked_at is null and (signer_id = auth.uid() or public.my_role() = 'superadmin');
  if not found then raise exception 'الورقة غير موجودة أو ملغاة من قبل'; end if;
end $$;
grant execute on function public.sig_revoke(text) to authenticated;

-- صفحة التحقق العامة (بلا تسجيل دخول): نص الورقة الأصلي ومن وقّعها ومتى، وهل أُلغيت. لا تُرجع صورة التوقيع
create or replace function public.verify_doc(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'title', title, 'body', body, 'hash', hash, 'signer_name', signer_name, 'signer_title', signer_title,
    'at', created_at, 'revoked', revoked_at is not null, 'revoked_at', revoked_at)
  from signed_docs where code = upper(trim(p_code))
$$;
grant execute on function public.verify_doc(text) to anon, authenticated;
