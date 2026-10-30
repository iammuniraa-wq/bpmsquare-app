-- 0241: Emails written to the client from a tender (the Interactions tab).
-- KAMCO feedback, slice 11 (docs/design/kamco-feedback-build-spec.md, owner answer 4). Needs 0120 (opportunities).
--
-- tender_client_messages: one row for each email composed on the Interactions tab and sent to the client through the tender:
--
--   to_text    where it went, as written; on a demo workspace the redirect is named instead of the typed address
--   subject    the subject line
--   body       the message, ENCRYPTED by the application (src/lib/encryption.ts): this is private correspondence, like the Inbox
--   redirected true when the workspace's email output setting sent it to a test inbox instead
--
-- Replies and the email the tender came from are NOT stored here: they already live in the Inbox (inbound_emails, record_sources) and
-- the tab reads them from there, each person seeing only what their channel's team may see.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): enabled with NO policy, on purpose, like every Inbox table. Mail is private, so
-- nothing but the application reaches it, on the service role, with an explicit tenant_id filter on every query.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Interactions tab still shows the source email, the Inbox
-- mail and the Sent to client records, says that sending from here needs a database update, and hides the compose button (42P01 /
-- PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.opportunities') is null then
    raise exception 'Run 0120 (opportunities) first, then run this again.';
  end if;
end $$;

create table if not exists tender_client_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  sent_by         uuid,
  to_text         text not null check (char_length(to_text) between 1 and 300),
  subject         text not null check (char_length(subject) between 1 and 300),
  body            text,
  redirected      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists tender_client_messages_deal_idx on tender_client_messages (tenant_id, opportunity_id, sent_at desc);

alter table tender_client_messages enable row level security;
-- No policy on purpose (see the header).
