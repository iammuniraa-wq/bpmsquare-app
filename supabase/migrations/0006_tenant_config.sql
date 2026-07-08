-- Add config JSONB column to tenants for local-admin-configurable settings:
-- entities (legal company names, addresses, GSTIN) and tax configuration.
-- Shape: { entities: TenantEntity[], tax: { label, rate, inclusive } }

alter table tenants
  add column if not exists config jsonb not null default '{}'::jsonb;
