-- run-bundle-50-tender-boq-client-format-2026-11-01.sql
-- The tender BOQ in the client's own Excel layout: Narration + Description, client columns, title block. = migration 0242. Safe to run twice. Paste into the Supabase SQL editor of each database (dev, then production, then KAMCO). Needs 0223 (bundle 33).

-- 0242_tender_boq_client_format.sql
--
-- Tender BOQ in the client's own Excel layout (docs/design/boq-client-format.md). KAMCO's file has Sr #, Bill #, Section, Page #,
-- Revision #, Item #, Boq #, Narration, Description, Unit, QTY, Rate, Amount under a Project Code / Project Name block. Needs 0223.
--
-- tender_boq_lines.file_details  the long Description, kept next to the short Narration that becomes the line's name (file_description).
--                                Null for a file that has only a Description.
-- tender_boq_lines.client_data   the other columns of the client's file as header label -> cell text, so nothing is lost.
-- tender_boq_sources.header_info the title block above the table: { project_code, project_name, tender_no, client }.
--
-- Columns only: the tables already have a tenant SELECT policy and no write policy (0223), and every write is a service-role route
-- that filters on the workspace, so no policy changes here. Idempotent; safe to run twice. Hand-applied by the owner: until it runs,
-- an upload still works (the name is the Narration, else the Description) and the details, client columns and title block are left
-- out with one visible notice, "Applying this layout fully needs a database update (migration 0242)".

do $$
begin
  if to_regclass('public.tender_boq_lines') is null then
    raise exception 'Run 0223 (the tender BOQ, bundle 33) first, then run this again.';
  end if;
end $$;

alter table tender_boq_lines add column if not exists file_details text;
alter table tender_boq_lines add column if not exists client_data jsonb;
alter table tender_boq_sources add column if not exists header_info jsonb;
