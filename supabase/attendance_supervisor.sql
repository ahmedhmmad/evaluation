-- Supervisors see the attendance screen and export its reports (detailed absence list with contacts).
-- Read-only: they can read student records and attendance, and change nothing (recording stays with the superadmin and registrars).
-- The manager already reads both (manager.sql).
-- Run this file once in the Supabase SQL Editor, after students.sql and attendance.sql. It does not change existing data.

drop policy if exists students_supervisor_read on public.students;
create policy students_supervisor_read on public.students
  for select to authenticated using (public.my_role() = 'supervisor');

drop policy if exists attendance_supervisor_read on public.attendance;
create policy attendance_supervisor_read on public.attendance
  for select to authenticated using (public.my_role() = 'supervisor');
