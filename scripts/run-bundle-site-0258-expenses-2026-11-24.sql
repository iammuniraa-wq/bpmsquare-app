-- run-bundle-site-0258-expenses-2026-11-24.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then PCBS). Safe to run twice.
-- Run AFTER 0226 (bundle 36, contract projects). No seed.
-- = migration 0258: Site expenses (docs/design/pcbs-site-receipt-expenses.md).
--   site_expense_categories, site_expenses (RLS on, SELECT policy only: author or admin), site_files (same), and the private storage bucket site-evidence
-- The app works before and after: the modules are hidden behind platform-admin flags (default off); until this has run a flagged-on
--   workspace sees "a database update is needed" and nothing crashes. Wrapped in one transaction.

begin;

-- 0258: Site expenses (docs/design/pcbs-site-receipt-expenses.md, section 4). First user: the PCBS contract projects; generic.
-- Needs 0226 (contract projects). Hidden behind the platform-admin flag `site_expenses` (default off).
--
-- 1. site_expense_categories: the six categories a site person picks from, each mapped to an existing resource type (resource_code) and
--    an optional cost code, with the ERP category id typed once and an optional per-expense limit. Edited in Settings by an admin.
-- 2. site_expenses: one cost claim. SEX-#### ref. client_id is the phone's idempotency key (unique per workspace): a queued capture that is
--    sent twice never makes two rows. status submitted / approved / rejected (returned) / cancelled; the ERP side is stored apart
--    (erp_state not_sent / sent / posted / failed, erp_ref, posted_amount) and is filled by the daily Excel register today and the ERP
--    read-back later. The expense NEVER writes project_budget_lines.actual: that column stays "posted by the ERP" only; Recorded is
--    computed from approved rows.
-- 3. site_files: the photos and the signature of an expense or a receipt (evidence), in the private storage bucket site-evidence.
--    Shared with 0259 (receipts), which needs this migration first.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the WFM and 0199 lessons): a site expense is money and a receipt is evidence, so a member must not be
-- able to forge or change one through PostgREST with their own session token. Every table has RLS ON and a SELECT policy only: no
-- insert / update / delete policy exists, and every write is a service-role route that has checked the tenant, the project and the caller.
-- site_expenses and site_files are readable by their author and by a workspace admin; the pickers and lists the app draws read through the
-- service role with their own checks.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the module stays empty and says a database update is needed
-- (42P01 / 42703 / PGRST204 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
end $$;

create table if not exists site_expense_categories (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  resource_code text check (resource_code is null or char_length(resource_code) <= 20),
  cost_code     text check (cost_code is null or char_length(cost_code) <= 40),
  erp_category  text check (erp_category is null or char_length(erp_category) <= 60),
  limit_amount  numeric(14,2) check (limit_amount is null or limit_amount > 0),
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create unique index if not exists site_expense_categories_name_uniq on site_expense_categories (tenant_id, name);

create table if not exists site_expenses (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  ref                text,
  project_id         uuid not null references contract_projects(id) on delete cascade,
  client_id          uuid not null,
  status             text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'cancelled')),
  category_id        uuid references site_expense_categories(id) on delete set null,
  line_key           uuid,
  wbs_code           text check (wbs_code is null or char_length(wbs_code) <= 50),
  expense_date       date not null,
  amount             numeric(14,2) not null check (amount > 0),
  currency           text not null check (char_length(currency) = 3),
  amount_project_ccy numeric(14,2) check (amount_project_ccy is null or amount_project_ccy > 0),
  vat_amount         numeric(14,2) check (vat_amount is null or vat_amount >= 0),
  vendor_text        text check (vendor_text is null or char_length(vendor_text) <= 200),
  supplier_id        uuid references suppliers(id) on delete set null,
  document_state     text not null default 'receipt_attached' check (document_state in ('receipt_attached', 'invoice_to_follow')),
  invoice_ref        text check (invoice_ref is null or char_length(invoice_ref) <= 100),
  paid_by            text not null default 'company' check (paid_by in ('company', 'self_paid', 'card', 'advance')),
  note               text check (note is null or char_length(note) <= 1000),
  flags              jsonb not null default '[]'::jsonb,
  photo_hash         text check (photo_hash is null or char_length(photo_hash) <= 80),
  submitted_by       uuid not null,
  submitted_at       timestamptz not null default now(),
  approved_by        uuid,
  approved_at        timestamptz,
  reject_reason      text check (reject_reason is null or char_length(reject_reason) <= 1000),
  cancel_reason      text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  ai_read            jsonb,
  source_type        text check (source_type is null or char_length(source_type) <= 40),
  source_id          uuid,
  erp_ref            text check (erp_ref is null or char_length(erp_ref) <= 100),
  erp_state          text not null default 'not_sent' check (erp_state in ('not_sent', 'sent', 'posted', 'failed')),
  sent_at            timestamptz,
  sent_by            uuid,
  posted_amount      numeric(14,2),
  posted_at          timestamptz,
  custom_data        jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists site_expenses_client_uniq on site_expenses (tenant_id, client_id);
create unique index if not exists site_expenses_tenant_ref_uniq on site_expenses (tenant_id, ref) where ref is not null;
create index if not exists site_expenses_project_idx on site_expenses (tenant_id, project_id, status, expense_date desc);
create index if not exists site_expenses_person_idx on site_expenses (tenant_id, submitted_by, expense_date desc);

create table if not exists site_files (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  object_type  text not null check (object_type in ('site_expense', 'site_receipt')),
  object_id    uuid not null,
  kind         text not null default 'photo' check (kind in ('photo', 'signature')),
  storage_path text not null check (char_length(storage_path) <= 300),
  mime_type    text check (mime_type is null or char_length(mime_type) <= 100),
  size_bytes   int check (size_bytes is null or size_bytes >= 0),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists site_files_object_idx on site_files (tenant_id, object_type, object_id);

alter table site_expense_categories enable row level security;
drop policy if exists "site_expense_categories: tenant read" on site_expense_categories;
create policy "site_expense_categories: tenant read" on site_expense_categories for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table site_expenses enable row level security;
drop policy if exists "site_expenses: author or admin read" on site_expenses;
create policy "site_expenses: author or admin read" on site_expenses for select
  using (submitted_by = auth.uid() or tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

alter table site_files enable row level security;
drop policy if exists "site_files: author or admin read" on site_files;
create policy "site_files: author or admin read" on site_files for select
  using (created_by = auth.uid() or tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

-- A private bucket, no policy: only the service role (the routes) reaches it; the app hands out 60-second signed links.
insert into storage.buckets (id, name, public) values ('site-evidence', 'site-evidence', false) on conflict (id) do nothing;

commit;
