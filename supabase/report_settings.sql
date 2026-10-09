-- Text shown in the letterhead and footer of every printed report.
-- Run this file once in the Supabase SQL Editor.

alter table public.settings
  add column if not exists report_subtitle text not null default '',   -- stage / department line under the academy name
  add column if not exists academic_year text not null default '',     -- e.g. 2026/2027; worked out from today's date when empty
  add column if not exists contact_info text not null default '';      -- address, phone, email: printed in the footer
