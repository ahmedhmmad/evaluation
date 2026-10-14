-- Staff records: the teachers table now holds every staff member (administration, teaching staff,
-- Quran teachers, support services), each with a category, a job title and a WhatsApp number.
-- Only teaching staff appear in the teacher evaluation screens.
-- Run this file once in the Supabase SQL Editor, after teacher_accounts.sql. It does not change existing data
-- (existing rows become "هيئة تدريس").

alter table public.teachers
  add column if not exists category text not null default 'هيئة تدريس'
    check (category in ('إدارية', 'هيئة تدريس', 'محفظون', 'خدمات مساندة', 'خدمات معاونة')),
  add column if not exists job_title text not null default '',
  add column if not exists whatsapp text not null default '';
