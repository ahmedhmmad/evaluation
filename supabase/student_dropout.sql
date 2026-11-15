-- «منقطع»: حالة تسجيل جديدة بجانب المبدئي والاحتياط والنهائي.
-- المنقطع يخرج من كشوف الحضور والباصات وعدد الشعبة (كل ما يعدّ الطلاب يأخذ النهائي والاحتياط فقط).
-- لا ينقله إلى «منقطع» ولا يعيده منها إلا المدير العام، ولا يعود إلا بعد توقيع ولي الأمر إقرار الالتزام:
-- عند الإعادة يُسجَّل في details.dropout_log سطر فيه back_at و pledge = true، وإلا رُفض الحفظ.
-- شغّل هذا الملف مرة في محرر SQL في Supabase. لا يغيّر بيانات موجودة.

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('pending', 'reserve', 'final', 'dropped'));

create or replace function public.students_dropout_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare was boolean := false;
        now_d boolean := new.status = 'dropped';
        last jsonb;
begin
  if tg_op = 'UPDATE' then was := old.status = 'dropped'; end if;
  if was = now_d then return new; end if;
  -- محرر SQL (بلا مستخدم) مسموح له؛ ومن الموقع: المدير العام فقط
  if auth.uid() is not null and coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception 'نقل الطالب إلى «منقطع» أو إعادته منها للمدير العام فقط';
  end if;
  if was and not now_d and auth.uid() is not null then
    last := new.details -> 'dropout_log' -> -1;
    if last is null or coalesce(last ->> 'pledge', '') <> 'true' or coalesce(last ->> 'back_at', '') = '' then
      raise exception 'لا يعود الطالب المنقطع إلا بعد توقيع ولي الأمر إقرار الالتزام';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists students_dropout_guard on public.students;
create trigger students_dropout_guard before insert or update of status on public.students
  for each row execute function public.students_dropout_guard();
