-- run-bundle-53-pdf-slice1-2026-11-23.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then PCBS). Safe to run twice. No seed here: the PCBS frame and layout
-- are scripts/seed-pcbs-pdf-design.sql, run on the PCBS database only, and need no migration.
-- Needs nothing else (standard_quotes and accounts already exist).
-- = migration 0251: the columns a framed quotation needs (docs/design/pdf-design-system.md, slice 1).
--   standard_quotes.subject / project_title / entity_id / doc_sections / source_type / source_id, and accounts.print_ids.
-- The app works before and after: until it runs, the quotation's front block omits the two fields, per-quotation sections print the layout's
--   defaults, the "Document" tab and the "Made from" line are hidden; the Settings > PDF documents page, the frame itself and the Standard Quote
--   number pattern need no migration. Wrapped in one transaction.

begin;

-- 0251: PDF design slice 1 (docs/design/pdf-design-system.md, 4.6): the columns a framed quotation needs.
-- Needs 0053 (standard_quotes) and the accounts table. Columns only, no new table.
--
--   standard_quotes.subject / project_title   the two front-block fields of the sample quotation ("Project Title", "Subject")
--   standard_quotes.entity_id                 the legal entity (tenants.config.entities[].id) that issues the quotation; the page frame
--                                             prints that entity's address, C.R. and VAT numbers. Text, because an entity id lives in
--                                             JSON, not in a table. Checked against config.entities by the routes before it is written.
--   standard_quotes.doc_sections              what this quotation holds per document for the layout sections marked "edit per
--                                             document" (clause text, scope-matrix ticks and remarks), keyed by layout block id
--   standard_quotes.source_type / source_id   where the quotation was made from (rule 7 of 3c): email | estimate | drawing | lead |
--                                             opportunity | standard_quote | quotation | project | direct, and the record. No foreign
--                                             key: it points at one of several tables; the routes verify it against the tenant.
--   accounts.print_ids                        the entity extra ids (for example a vendor number) this customer sees on printed documents
--
-- No RLS change: standard_quotes and accounts keep their existing tenant-isolation policies (0053, 0001); this adds columns only.
-- (No member write policy exists or is added for any NEW table: there is none in this migration.)
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the quotation's front block omits the two fields, the
-- per-quotation sections print the layout's defaults, the "Document" tab and the "Made from" line are hidden, and the entity and account
-- pick are not offered (42703 / PGRST204 are read as "not there yet"). Nothing else changes.

alter table standard_quotes add column if not exists subject text check (subject is null or char_length(subject) <= 300);
alter table standard_quotes add column if not exists project_title text check (project_title is null or char_length(project_title) <= 300);
alter table standard_quotes add column if not exists entity_id text check (entity_id is null or char_length(entity_id) <= 64);
alter table standard_quotes add column if not exists doc_sections jsonb;
alter table standard_quotes add column if not exists source_type text
  check (source_type is null or source_type in ('email', 'estimate', 'drawing', 'lead', 'opportunity', 'standard_quote', 'quotation', 'project', 'direct'));
alter table standard_quotes add column if not exists source_id uuid;

create index if not exists standard_quotes_source on standard_quotes (tenant_id, source_type, source_id) where source_id is not null;

alter table accounts add column if not exists print_ids text[];

commit;
