-- 0263: Supplier check -- is this supplier genuine, what is its market reputation, what is our own rating of it.
-- One row per run of the check on a supplier of the master data (not per bid). Needs suppliers (0000) and tenants.
--
-- The result steers who is asked and who is awarded, so it is internal and read-only for members:
--   * RLS on, a tenant SELECT policy and NO write policy. Every write is a service-role route that has already checked the tenant,
--     the supplier and the person's right to edit suppliers (the WFM and 0199 lessons in MULTI_TENANT_GUARDRAILS.md). A member
--     cannot forge or erase a check through PostgREST with their own session token.
--   * No v1 API exposure: the rating and the findings are internal.
--
-- Columns:
--   verdict               looks_genuine | check_first | concerning | unverified   (a risk indicator, not a legal finding)
--   genuine_findings      {signals:[...], positives:[...]} computed from the workspace's own records
--   our_rating            0.00 - 5.00 from our own RFQ history over 24 months, null when there is not enough history
--   our_rating_basis      the components, their weights and the sample sizes the rating was built from
--   reputation_*          the web part (only when the person agreed to web research): summary, sentiment and the dated facts
--   sources               [{title, url}] the web facts came from, as the company brief stores them
--   web_used              whether web research ran for this row
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the card says "needs a database update (migration 0263)"
-- and the list columns stay empty; 42P01 / PGRST205 are read as "no check yet".

create table if not exists supplier_checks (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  supplier_id        uuid not null references suppliers(id) on delete cascade,
  checked_at         timestamptz not null default now(),
  checked_by         uuid,
  verdict            text not null check (verdict in ('looks_genuine','check_first','concerning','unverified')),
  genuine_findings   jsonb not null default '{}'::jsonb,
  our_rating         numeric(3,2) check (our_rating is null or (our_rating >= 0 and our_rating <= 5)),
  our_rating_basis   jsonb not null default '{}'::jsonb,
  reputation_summary text,
  reputation_sentiment text not null default 'unknown' check (reputation_sentiment in ('positive','mixed','negative','unknown')),
  reputation_facts   jsonb not null default '[]'::jsonb,
  sources            jsonb not null default '[]'::jsonb,
  web_used           boolean not null default false,
  model              text
);

create index if not exists supplier_checks_supplier on supplier_checks (tenant_id, supplier_id, checked_at desc);

alter table supplier_checks enable row level security;
drop policy if exists "supplier_checks: tenant read" on supplier_checks;
create policy "supplier_checks: tenant read" on supplier_checks for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
