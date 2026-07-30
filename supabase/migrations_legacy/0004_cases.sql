-- Case module — service cases, photos per stage, inspection reports.

create table service_cases (
  id           text primary key,
  account_id   uuid not null references accounts(id),
  ref          text not null unique,
  type         text not null check (type in ('amc','adhoc','direct')),
  status       text not null,
  asset_id     uuid references assets(id),
  equipment_label text not null,
  complaint    text not null,
  assigned_to  uuid references technicians(id),
  intake_at    timestamptz not null,
  closed_at    timestamptz,
  quote_id     uuid references quotes(id),
  contract_id  uuid references contracts(id),
  has_loaner   boolean not null default false,
  disposition  text check (disposition in ('repair','buyback','scrap')),
  notes        text
);

create index on service_cases(account_id);
create index on service_cases(status);

create table case_photos (
  id        text primary key,
  case_id   text not null references service_cases(id) on delete cascade,
  stage     text not null check (stage in ('intake','inspection','final')),
  caption   text not null,
  url       text,
  taken_at  timestamptz not null
);

create index on case_photos(case_id);

create table inspection_reports (
  id              text primary key,
  case_id         text not null references service_cases(id) on delete cascade,
  findings        text not null,
  recommendations text not null,
  estimated_cost  integer,
  status          text not null default 'draft'
                    check (status in ('draft','sent','approved','rejected')),
  sent_at         timestamptz,
  approved_at     timestamptz
);

create unique index on inspection_reports(case_id);
