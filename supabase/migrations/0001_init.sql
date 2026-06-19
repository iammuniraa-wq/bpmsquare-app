-- VeveyCRM — initial schema. The Account is the hub: every object carries
-- account_id and nothing exists without an account. PROJECT.md §3 (LOCKED).

create extension if not exists "pgcrypto";

-- ── The hub ──────────────────────────────────────────────────────────────
create table accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null check (type in ('oem', 'direct', 'end_customer')),
  city        text,
  phone       text,
  email       text,
  -- OEM that referred this account (when type = end_customer)
  referred_by_account_id uuid references accounts(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table technicians (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  skills  text
);

-- ── Children — every one references the hub ──────────────────────────────
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  email       text
);

create table sites (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  label       text not null,
  address     text
);

create table assets (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  kind        text not null check (kind in ('motor','transformer','pump','generator','panel')),
  name        text not null,
  rating      text,
  serial      text
);

create table contracts (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  ref               text not null,
  holder_account_id uuid references accounts(id) on delete set null,
  status            text not null check (status in ('active','expired','draft')),
  start_date        date,
  end_date          date,
  value             numeric(12,2)
);

create table leads (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  title       text not null,
  source      text not null check (source in ('oem_referral','amc','direct')),
  status      text not null check (status in ('new','inspecting','quoted','won','lost')),
  created_at  timestamptz not null default now()
);

create table quotes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  ref         text not null,
  status      text not null check (status in ('draft','sent','approved','rejected')),
  total       numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);

create table work_orders (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  ref             text not null,
  asset_id        uuid references assets(id) on delete set null,
  technician_id   uuid references technicians(id) on delete set null,
  -- Exactly one commercial wrapper authorizes the job (quote XOR contract).
  authorized_quote_id    uuid references quotes(id) on delete set null,
  authorized_contract_id uuid references contracts(id) on delete set null,
  status          text not null check (status in ('scheduled','in_progress','completed','invoiced')),
  scheduled_for   timestamptz,
  constraint one_wrapper check (
    (authorized_quote_id is not null)::int + (authorized_contract_id is not null)::int = 1
  )
);

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  ref           text not null,
  work_order_id uuid references work_orders(id) on delete set null,
  status        text not null check (status in ('draft','sent','paid','overdue')),
  total         numeric(12,2) not null default 0,
  issued_at     timestamptz
);

-- Unified timeline — one job travels across pillars. PROJECT.md §4.
create table activities (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  pillar      text not null check (pillar in ('marketing','sales','service','field','finance')),
  text        text not null,
  at          timestamptz not null default now()
);

-- Hub lookups: every child is filtered by account_id constantly.
create index on contacts(account_id);
create index on sites(account_id);
create index on assets(account_id);
create index on contracts(account_id);
create index on leads(account_id);
create index on quotes(account_id);
create index on work_orders(account_id);
create index on invoices(account_id);
create index on activities(account_id);
