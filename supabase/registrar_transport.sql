-- المسجِّل في «المواصلات»: يرى الباصات ودفعات الطلاب وسجلها، ويضيف الطلاب إلى الباصات ويزيلهم، ويصدر الإيصالات
-- (الإيصال الأول والإيصالات المكمِّلة). لا يحذف إيصالًا ولا يلغيه ولا يسترد ولا يعفي ولا يعدّل الرسوم والدورات والباصات نفسها،
-- ولا يرى إيصالات الموظفين. حماية الإيصالات المسجَّلة (receipts_lock.sql) تبقى على الجميع: لا يُخفَّض إيصال ولا يُعدَّل رقمه.
-- شغّل هذا الملف في محرر SQL في Supabase (بعد registrar.sql و transport.sql و transport_topups.sql و transport_refunds.sql)،
-- ويمكن تشغيله مرة أخرى. لا يغيّر أي بيانات.

drop policy if exists transport_payments_registrar_read on public.transport_payments;
create policy transport_payments_registrar_read on public.transport_payments
  for select to authenticated using (public.my_role() = 'registrar');
drop policy if exists transport_payments_registrar_insert on public.transport_payments;
create policy transport_payments_registrar_insert on public.transport_payments
  for insert to authenticated with check (public.my_role() = 'registrar');
drop policy if exists transport_payments_registrar_update on public.transport_payments;
create policy transport_payments_registrar_update on public.transport_payments
  for update to authenticated using (public.my_role() = 'registrar') with check (public.my_role() = 'registrar');

do $$
begin
  if to_regclass('public.transport_topups') is not null then
    drop policy if exists transport_topups_registrar_read on public.transport_topups;
    create policy transport_topups_registrar_read on public.transport_topups
      for select to authenticated using (public.my_role() = 'registrar');
    drop policy if exists transport_topups_registrar_insert on public.transport_topups;
    create policy transport_topups_registrar_insert on public.transport_topups
      for insert to authenticated with check (public.my_role() = 'registrar');
  end if;
  -- المبالغ تُعرض صافية بعد الاسترداد، فيقرأ المسترَدّ (ولا يسجّله)
  if to_regclass('public.transport_refunds') is not null then
    drop policy if exists transport_refunds_registrar_read on public.transport_refunds;
    create policy transport_refunds_registrar_read on public.transport_refunds
      for select to authenticated using (public.my_role() = 'registrar');
  end if;
end $$;
