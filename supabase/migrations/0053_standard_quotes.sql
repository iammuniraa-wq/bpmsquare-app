-- 0053_standard_quotes.sql
-- Standard Quote: a deliberately independent, non-configurable quote object --
-- own tables, own status pipeline, own routes, own UI/PDF components. Does not
-- share quotes/quote_lines or any of their tenant-specific customization
-- (custom_data, entity_id-driven layout branches, alternative option groups,
-- discount_type variants, the extension-hook system). Still references the
-- shared accounts/contacts tables -- a quote has to point at a real customer,
-- and forking customer data would fracture the CRM, not keep it standard.

create table standard_quotes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  ref          text not null,
  account_id   uuid not null references accounts(id) on delete restrict,
  contact_id   uuid references contacts(id) on delete set null,
  status       text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  valid_until  date,
  terms        text,
  notes        text,
  subtotal     numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_at      timestamptz,
  unique (tenant_id, ref)
);

create index standard_quotes_tenant_idx on standard_quotes (tenant_id, created_at desc);
create index standard_quotes_account_idx on standard_quotes (tenant_id, account_id);

alter table standard_quotes enable row level security;

create policy "standard_quotes: tenant isolation" on standard_quotes for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table standard_quote_lines (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  standard_quote_id  uuid not null references standard_quotes(id) on delete cascade,
  sl_no              text,
  description        text not null,
  uom                text,
  qty                numeric(10,2) not null default 1,
  rate               numeric(12,2) not null default 0,
  discount_pct       numeric(5,2) not null default 0,
  amount             numeric(12,2) not null default 0
);

create index standard_quote_lines_quote_idx on standard_quote_lines (standard_quote_id);

alter table standard_quote_lines enable row level security;

create policy "standard_quote_lines: tenant isolation" on standard_quote_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
