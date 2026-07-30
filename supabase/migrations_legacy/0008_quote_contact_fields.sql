-- Additional fields needed by the full quote form
alter table quotes
  add column if not exists name          text,
  add column if not exists contact_id    text,
  add column if not exists po_number     text,
  add column if not exists po_amount     numeric(14,2),
  add column if not exists discount_type text    not null default 'pct',
  add column if not exists discount_pct  numeric(5,2) not null default 0,
  add column if not exists discount_fixed numeric(14,2) not null default 0,
  add column if not exists asset_ids     text[]  not null default '{}';

-- Prevent duplicate refs within a tenant
create unique index if not exists quotes_tenant_ref_uniq on quotes (tenant_id, ref);
