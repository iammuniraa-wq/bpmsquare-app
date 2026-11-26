-- run-bundle-58-supplier-checks-2026-11-27.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then KAMCO). Safe to run twice. No seed.
-- No other migration is needed first (needs suppliers and tenants only).
-- = migration 0263: supplier_checks (Supplier check on the supplier master data). RLS on, tenant SELECT policy only, NO write
--   policy: service-role routes write it, because the result steers who is asked and awarded.
-- The app works before and after: until this has run the Supplier check card says "needs a database update (migration 0263)", the
--   Rating and Check columns on the suppliers list are empty, and nothing else changes. Wrapped in one transaction.

begin;

-- 0263: Supplier check -- genuineness, market reputation and our own rating of a supplier of the master data.
-- RLS: a tenant SELECT policy and NO write policy (the WFM and 0199 lessons): every write is a service-role route.
-- No v1 API exposure: the rating and the findings are internal.

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

commit;
