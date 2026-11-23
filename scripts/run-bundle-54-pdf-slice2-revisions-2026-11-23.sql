-- run-bundle-54-pdf-slice2-revisions-2026-11-23.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then PCBS). Safe to run twice. No seed.
-- Run AFTER 0251 (bundle 53, PDF slice 1). Needs standard_quotes (0053).
-- = migration 0252: revision history of a document (docs/design/pdf-design-system.md, slice 2).
--   document_revisions        one immutable row per issue (RLS on, tenant SELECT policy only, NO write policy: service-role routes write it;
--                             an update trigger refuses changes)
--   standard_quotes.current_revision / revision_state / pending_revision_reason
-- The app works before and after: the switch "Keep revisions and lock issued quotes" (Settings > Company > Numbering) is off by default and
--   does nothing until this has run; until then nothing is locked, the Revisions tab and the Issue / Revise buttons are hidden and a quote
--   is sent exactly as today. Wrapped in one transaction.

begin;

-- 0252: revision history of a document (PDF design slice 2, docs/design/pdf-design-system.md, 4.9).
-- Needs 0251 (standard_quotes columns) and 0053 (standard_quotes). Standard Quotes use it first; the sales order and the new PCBS
-- documents reuse the same table later, so object_type is open text (a format check, not a closed list).
--
-- 1. document_revisions: one row per issue of a document. ONE RECORD, MANY REVISIONS: the quotation keeps its record and its number
--    for life; each issue adds an immutable revision (the bid-version pattern of 0225). revision_no is 0 on the first issue, then 1, 2 ...
--    and the unique key makes two people issuing at once safe (the second insert fails and is told so). From revision 1 the reason is
--    required (checked here as well as in the route). `snapshot` holds everything that was PRINTED (number, dates, customer and contact as
--    printed, front block, lines and prices, totals, the per-quotation sections, the resolved layout, the page-frame values used): a later
--    edit of the boilerplate never rewrites what a customer already holds. It NEVER carries a cost, a margin or a pricing flag (the 0230
--    lesson); the route builds it from an explicit field list.
--    A trigger refuses an UPDATE. Nothing here refuses a DELETE: the only deletes are the tenant's own cascade and a service-role
--    compensation when the quotation row could not be marked issued straight after.
-- 2. standard_quotes.current_revision / revision_state / pending_revision_reason: the number of the latest issued revision (null = none
--    yet), where the working copy stands ('draft' = in preparation, 'issued' = locked), and the reason typed when "Revise" was pressed,
--    carried into the next revision row when it is issued. Only the routes write them; they mean something only while the workspace has
--    turned on "Keep revisions and lock issued quotes" (tenants.config.revisions.standard_quote, off by default).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the WFM and 0199 lessons): document_revisions carries a tenant SELECT policy and NOTHING that
-- writes. An issued revision is the record of what was offered, so a member must not be able to forge or erase one through PostgREST;
-- issue and revise are service-role routes that have checked the tenant, the record and the caller's access. standard_quotes keeps its
-- existing tenant-isolation policy (columns only).
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, nothing is locked, the Revisions tab and the Issue and Revise
-- buttons are hidden and a quote is sent exactly as today without a revision row (42P01 / 42703 / PGRST204 / PGRST205 are read as
-- "not there yet").

do $$
begin
  if to_regclass('public.standard_quotes') is null then
    raise exception 'Run 0053 (standard quotes) first, then run this again.';
  end if;
end $$;

create table if not exists document_revisions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  object_type  text not null check (object_type ~ '^[a-z_]{3,40}$'),
  object_id    uuid not null,
  revision_no  int not null check (revision_no >= 0),
  issued_at    timestamptz not null default now(),
  issued_by    uuid,
  reason       text check (reason is null or char_length(reason) between 3 and 1000),
  total        numeric(16,2) not null default 0,
  currency     text,
  snapshot     jsonb not null,
  unique (tenant_id, object_type, object_id, revision_no),
  check (revision_no = 0 or reason is not null)
);

create index if not exists document_revisions_object on document_revisions (tenant_id, object_type, object_id, revision_no desc);

create or replace function document_revisions_no_update() returns trigger as $$
begin
  raise exception 'an issued revision cannot be changed';
end;
$$ language plpgsql;

drop trigger if exists document_revisions_immutable on document_revisions;
create trigger document_revisions_immutable before update on document_revisions
  for each row execute function document_revisions_no_update();

alter table document_revisions enable row level security;
drop policy if exists "document_revisions: tenant read" on document_revisions;
create policy "document_revisions: tenant read" on document_revisions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table standard_quotes add column if not exists current_revision int check (current_revision is null or current_revision >= 0);
alter table standard_quotes add column if not exists revision_state text check (revision_state is null or revision_state in ('draft', 'issued'));
alter table standard_quotes add column if not exists pending_revision_reason text check (pending_revision_reason is null or char_length(pending_revision_reason) <= 1000);

commit;
