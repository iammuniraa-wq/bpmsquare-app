-- Quote revision tracking.

alter table quotes
  add column if not exists revision integer not null default 1;

create table quote_revisions (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  rev         integer not null,
  date        date not null,
  description text not null,
  unique (quote_id, rev)
);

create index on quote_revisions(quote_id);
