-- Standard Quote attachments (owner decision 2026-09-06, docs/
-- sales-engine-architecture.md §3.7): customer communication stored
-- against the quote -- emails, PDFs, spreadsheets -- and, for a
-- spreadsheet, "create line items from this file".
--
-- Files live in a PRIVATE bucket (customer correspondence is never a
-- public URL): the API uploads and signs download links with the service
-- role; no storage policy grants clients direct access, so the anon and
-- authenticated roles can neither list nor read the bucket. Path:
-- {tenant_id}/{standard_quote_id}/{uuid}.{ext} -- first segment is the
-- tenant id, matching the (storage.foldername(name))[1] convention should
-- scoped policies ever be added.

create table if not exists standard_quote_attachments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  standard_quote_id  uuid not null references standard_quotes(id) on delete cascade,
  file_name          text not null,
  storage_path       text not null,
  mime_type          text,
  size_bytes         bigint not null default 0,
  note               text,
  uploaded_by        uuid,
  created_at         timestamptz not null default now()
);

alter table standard_quote_attachments enable row level security;

create policy "standard_quote_attachments: tenant isolation"
  on standard_quote_attachments for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create index if not exists standard_quote_attachments_quote
  on standard_quote_attachments (tenant_id, standard_quote_id);

insert into storage.buckets (id, name, public)
values ('quote-attachments', 'quote-attachments', false)
on conflict (id) do nothing;
