-- run-bundle-23-inbox-2026-10-24.sql
-- The shared customer Inbox (docs/design/estimator-unification-and-inbox.md). Paste into the Supabase SQL editor of each database (dev, then production).
-- = migration 0214 (inbox_channels, inbound_emails, inbound_email_attachments, inbox_mailbox_state, record_files, record_sources, the private
-- 'inbox-attachments' bucket, and the 'inbox' kind on email_log). Safe to run twice. Run scripts/seed-inbox-demo.sql AFTER it for the demo workspace.
-- Until it is run the Inbox shows "database update needed"; nothing else in the product changes.


-- 0214_inbox.sql
--
-- The shared customer Inbox (docs/design/estimator-unification-and-inbox.md, gcc-sales-estimating-plan.md section 4).
-- Mail a customer sends to a company address lands here, is read by a team, answered from here and turned into a Quote,
-- Project, Case, Lead or Estimate.
--
--   inbox_channels            one row per address a workspace listens on: the forwarding alias, an optional connected
--                             mailbox, which Business Roles see and reply, what "Create" offers first, the reply-from.
--   inbound_emails            every message in the thread, in ('in') and our replies ('out'). Body and snippet are
--                             encrypted by the application (src/lib/encryption.ts), exactly like WhatsApp text.
--                             Idempotent per provider message id and per RFC Message-ID.
--   inbound_email_attachments files kept in a private bucket, with a quality label decided by type and size.
--   inbox_mailbox_state       the IMAP UID cursor per connected mailbox (the pattern of rfq_mailbox_state).
--   record_files              files copied onto a Quote / Project / Case / Lead / Estimate when an email becomes one,
--                             so the customer's drawings outlive the email's own retention.
--   record_sources            who wrote and a short summary of what they asked, stored on the record that email became
--                             (the summary is encrypted by the application); shown on that record as "From email".
--
-- RLS: ENABLED on all six with NO policy at all. Mail is private correspondence: a member must not read it (or write a
-- row that claims a customer said something) straight through PostgREST with their own session token. The application is
-- the only reader and writer, on the service-role client, after its own module, workcenter and channel-team checks, and
-- every query names the tenant (MULTI_TENANT_GUARDRAILS.md; the same stance as integration_messages and api_keys).
-- src/lib/inbox/inboxRls.test.ts replays the migrations and fails the build if a policy is ever added.
--
-- Retention (owner decisions 2026-10-24): inbound_emails.expires_at is received + 90 days; once converted it becomes
-- converted_at + 30 days. /api/inbox/cron/purge deletes the body and the files past it and keeps a stub row.
--
-- Idempotent: safe to run twice. Nothing else is touched except widening email_log.kind (below).

create table if not exists inbox_channels (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  name                text not null,
  -- The local part of the forwarding address: inbox-<16 random characters>. Unique across the platform; it is the
  -- capability that names this channel. Rotating it ends the old address.
  address_alias       text not null,
  -- A connected mailbox read over IMAP (read-only, never marks mail read). tenant_connectors holds one row per
  -- connector, so one mailbox feeds one channel (unique below).
  connector_id        text check (connector_id in ('gmail', 'mail_server')),
  -- Business Roles who see and reply. Empty = everyone who can open the Inbox.
  role_ids            uuid[] not null default '{}',
  default_action      text not null default 'none'
    check (default_action in ('quote', 'project', 'case', 'estimate', 'lead', 'none')),
  default_template_id uuid,                       -- an estimate template; no foreign key so this file stands alone
  reply_from          text,
  reply_name          text,
  active              boolean not null default true,
  last_received_at    timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists inbox_channels_alias_uniq on inbox_channels (address_alias);
create unique index if not exists inbox_channels_connector_uniq on inbox_channels (tenant_id, connector_id) where connector_id is not null and active;
create index if not exists inbox_channels_tenant_idx on inbox_channels (tenant_id, name);

create table if not exists inbound_emails (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  channel_id           uuid not null references inbox_channels(id) on delete cascade,
  direction            text not null default 'in' check (direction in ('in', 'out')),
  provider             text not null,
  provider_message_id  text not null,
  message_id           text,                     -- RFC Message-ID, normalised
  in_reply_to          text,
  references_ids       text,
  thread_key           text,
  from_address         text,
  from_name            text,
  to_addresses         text[] not null default '{}',
  subject              text not null default '',
  body_text            text,                     -- encrypted by the application; null on a purged stub
  snippet              text,                     -- encrypted by the application
  received_at          timestamptz not null default now(),
  status               text not null default 'new' check (status in ('new', 'handled', 'spam')),
  assigned_to          uuid,
  linked_object_type   text check (linked_object_type in ('standard_quotes', 'wfm_projects', 'cases', 'estimates', 'leads')),
  linked_object_id     uuid,
  linked_object_label  text,
  converted_at         timestamptz,
  expires_at           timestamptz not null,
  purged_at            timestamptz,
  read_at              timestamptz,
  handled_at           timestamptz,
  handled_by           uuid,
  -- Our own replies ('out' rows)
  send_status          text check (send_status in ('sent', 'failed', 'redirected')),
  error                text,
  created_by           uuid,
  created_at           timestamptz not null default now()
);

create unique index if not exists inbound_emails_provider_uniq on inbound_emails (tenant_id, provider_message_id);
create unique index if not exists inbound_emails_message_uniq on inbound_emails (tenant_id, channel_id, message_id) where message_id is not null and direction = 'in';
create index if not exists inbound_emails_list_idx on inbound_emails (tenant_id, channel_id, status, received_at desc);
create index if not exists inbound_emails_thread_idx on inbound_emails (tenant_id, thread_key);
create index if not exists inbound_emails_expiry_idx on inbound_emails (expires_at) where purged_at is null;
create index if not exists inbound_emails_link_idx on inbound_emails (tenant_id, linked_object_type, linked_object_id) where linked_object_id is not null;

create table if not exists inbound_email_attachments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  email_id      uuid not null references inbound_emails(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,                   -- {tenant_id}/inbox/{email_id}/{uuid}.{ext} in the private bucket
  mime_type     text,
  ext           text,
  size_bytes    bigint not null default 0,
  quality       text not null default 'review' check (quality in ('good', 'review', 'poor')),
  quality_note  text,
  summary       text,                            -- what a reader found in the file; empty until one has run
  created_at    timestamptz not null default now()
);

create index if not exists inbound_email_attachments_email_idx on inbound_email_attachments (tenant_id, email_id);

create table if not exists inbox_mailbox_state (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  connector_id    text not null,
  uid_validity    bigint,
  last_uid        bigint not null default 0,
  last_polled_at  timestamptz,
  last_error      text,
  primary key (tenant_id, connector_id)
);

create table if not exists record_files (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  object_type      text not null check (object_type in ('standard_quotes', 'wfm_projects', 'cases', 'estimates', 'leads')),
  object_id        uuid not null,
  file_name        text not null,
  storage_path     text not null,
  mime_type        text,
  size_bytes       bigint not null default 0,
  source           text not null default 'email',
  source_email_id  uuid,                         -- no foreign key: the file must outlive the email's stub
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index if not exists record_files_object_idx on record_files (tenant_id, object_type, object_id);

create table if not exists record_sources (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  object_type      text not null check (object_type in ('standard_quotes', 'wfm_projects', 'cases', 'estimates', 'leads')),
  object_id        uuid not null,
  source_email_id  uuid,                         -- no foreign key: this must outlive the email's stub
  channel_name     text,
  from_address     text,
  from_name        text,
  subject          text,
  summary          text,                         -- encrypted by the application
  received_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (tenant_id, object_type, object_id, source_email_id)
);

create index if not exists record_sources_object_idx on record_sources (tenant_id, object_type, object_id);

alter table inbox_channels            enable row level security;
alter table inbound_emails            enable row level security;
alter table inbound_email_attachments enable row level security;
alter table inbox_mailbox_state       enable row level security;
alter table record_files              enable row level security;
alter table record_sources            enable row level security;
-- No policy on any of them, on purpose (see the header).

-- A private bucket for the files; the application uploads and signs short-lived download links with the service role.
-- No storage policy grants anon or authenticated anything, so neither can list or read it. The first path segment is
-- the tenant id, matching the (storage.foldername(name))[1] convention.
insert into storage.buckets (id, name, public, file_size_limit)
values ('inbox-attachments', 'inbox-attachments', false, 15728640)
on conflict (id) do nothing;

-- Our replies from the Inbox are recorded in email_log like every other business email. The kind list is widened IN
-- PLACE (the current definition plus 'inbox'), so a kind another migration added is never dropped by this one.
do $$
declare
  def text;
  widened text;
begin
  if to_regclass('public.email_log') is null then
    return;
  end if;
  select pg_get_constraintdef(oid) into def
    from pg_constraint where conrelid = 'public.email_log'::regclass and conname = 'email_log_kind_check';
  if def is null or position('''inbox''' in def) > 0 then
    return;
  end if;
  widened := regexp_replace(def, '\]\)', ', ''inbox''::text])');
  if widened = def then
    raise notice 'email_log_kind_check has an unexpected shape; add ''inbox'' to it by hand';
    return;
  end if;
  execute 'alter table email_log drop constraint email_log_kind_check';
  execute 'alter table email_log add constraint email_log_kind_check ' || widened;
end $$;
