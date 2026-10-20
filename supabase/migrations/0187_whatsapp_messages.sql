-- 0187: every WhatsApp message in or out (docs/shells/whatsapp-shell.md).
-- The message log is also the 24-hour window (the last 'in' row for a contact) and the weekly cap
-- (the 'out' rows in the last 7 days). Message text and the number it went to are encrypted: they
-- are personal data.
--
-- RLS: SELECT-ONLY for members. A row says "this was sent / this person replied": a trust claim that
-- drives the window rule, the caps and attribution, so it must not be forgeable with a member's own
-- session (MULTI_TENANT_GUARDRAILS.md, the WFM overtime lesson). Rows are written only by the send
-- function and the inbound webhook, on the service-role client.
--
-- `client_ref` makes a send idempotent (a journey step uses "<run>:<step>"); `provider_message_id`
-- makes an inbound replay or a repeated status callback a no-op.

create table if not exists whatsapp_messages (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  direction            text not null check (direction in ('out', 'in')),
  contact_id           uuid references contacts(id) on delete set null,
  account_id           uuid references accounts(id) on delete set null,
  template_id          uuid references whatsapp_templates(id) on delete set null,
  journey_id           uuid,                              -- no foreign key: this table must not depend on the journeys migrations having run
  kind                 text not null default 'template' check (kind in ('template', 'session', 'inbound')),
  -- Where it came from: a person on the record, a journey, or the provider.
  origin               text not null default 'rep' check (origin in ('rep', 'journey', 'provider')),
  status               text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'dry_run', 'received')),
  category             text,                              -- marketing | utility | authentication (counts toward the weekly cap when marketing)
  lang                 text,
  body                 text,                              -- encrypted
  to_phone             text,                              -- encrypted; the number it was meant for
  redirected_to        text,                              -- encrypted; set when a demo workspace sent it to a test number
  provider             text,
  provider_message_id  text,
  client_ref           text,
  error                text,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  received_at          timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now()
);

create index if not exists whatsapp_messages_contact_idx on whatsapp_messages (tenant_id, contact_id, created_at desc);
create index if not exists whatsapp_messages_recent_idx on whatsapp_messages (tenant_id, created_at desc);
create unique index if not exists whatsapp_messages_client_ref_uniq on whatsapp_messages (tenant_id, client_ref) where client_ref is not null;
create unique index if not exists whatsapp_messages_provider_uniq on whatsapp_messages (tenant_id, provider_message_id) where provider_message_id is not null;

alter table whatsapp_messages enable row level security;
drop policy if exists "whatsapp_messages: tenant read" on whatsapp_messages;
create policy "whatsapp_messages: tenant read" on whatsapp_messages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No insert/update/delete policy on purpose.
