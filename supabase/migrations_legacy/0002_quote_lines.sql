-- Quote line items + extend quotes with validity + notes.

alter table quotes
  add column if not exists valid_until date,
  add column if not exists notes      text;

create table quote_lines (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  description text not null,
  qty         numeric(10,2) not null default 1,
  rate        numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0
);

create index on quote_lines(quote_id);
