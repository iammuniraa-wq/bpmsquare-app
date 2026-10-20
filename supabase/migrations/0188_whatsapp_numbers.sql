-- 0188: which contact a WhatsApp number belongs to (docs/shells/whatsapp-shell.md).
-- Contact phones are encrypted with a random IV, so nothing can look a contact up by phone (the same
-- reason contacts.email_hash exists, docs/marketing-platform-architecture.md 1.1.1). An inbound
-- WhatsApp message arrives with only the sender's number, so this table holds a keyed hash of each
-- normalised number against the contact. It is filled when a message is sent and by "Match my
-- contacts' numbers" on the WhatsApp setup page. The hash cannot be turned back into a number without
-- the key; it is never shown, exported or returned by any API.
--
-- RLS: enabled with NO policy; only the service-role client reads or writes it, with the tenant on
-- every query. A number that matches no row creates nothing: an unsolicited message never makes a
-- contact.

create table if not exists whatsapp_numbers (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  phone_hash  text not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, contact_id, phone_hash)
);

create index if not exists whatsapp_numbers_lookup_idx on whatsapp_numbers (tenant_id, phone_hash);

alter table whatsapp_numbers enable row level security;
-- No policy on purpose: only the service-role client reads or writes this table.
