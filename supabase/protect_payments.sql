-- Protects transport payments from disappearing with a deleted student record.
-- Until now deleting a student also deleted that student's payments (on delete cascade).
-- After this file the database itself refuses to delete a student who still has payments:
-- the receipts have to be moved to the student's other record, voided (kept in the archive) or refunded first.
-- The page already does this check; this makes it hold whatever page or tool sends the delete.
-- Run this file once in the Supabase SQL Editor. It does not change existing data.

do $$
declare
  fk text;
begin
  for fk in
    select conname from pg_constraint
    where conrelid = 'public.transport_payments'::regclass
      and confrelid = 'public.students'::regclass
      and contype = 'f'
  loop
    execute format('alter table public.transport_payments drop constraint %I', fk);
  end loop;
  alter table public.transport_payments
    add constraint transport_payments_student_id_fkey
    foreign key (student_id) references public.students (id) on delete restrict;
end $$;
