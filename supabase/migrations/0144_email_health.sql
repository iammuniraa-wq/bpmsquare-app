-- 0144: email delivery health at CONTACT level (docs/newsletter-studio-architecture.md
-- section 12.5; owner request 2026-10-20: "delivered or bounced is important and
-- should be recorded on the contact level so sales can run validation from within
-- BPMSquare and fix it").
--
--  * contacts.email_status / email_status_at / email_status_reason: the health of
--    the contact's address. Written ONLY by the Resend webhook
--    (/api/webhooks/resend) and by the check / fix / mark-checked actions on the
--    contact record, all on the service-role client. The reason is a short plain
--    sentence, never a raw provider payload.
--  * marketing_campaign_recipients.resend_id / delivery_status / delivery_at: the
--    provider's message id (so a webhook can be tied to the row it belongs to) and
--    what happened to the message afterwards. `status` itself is untouched, so
--    today's "sent" counts stay exactly as they are.
--
-- Additive: every column is nullable or defaulted, nothing existing changes, and
-- the app degrades cleanly (42703 / PGRST204) while this is pending.
-- RLS: contacts and marketing_campaign_recipients keep the policies they already
-- have; the new columns inherit them.

alter table contacts add column if not exists email_status text not null default 'unknown'
  check (email_status in ('unknown', 'valid', 'soft_bounce', 'bounced', 'complained', 'invalid'));
alter table contacts add column if not exists email_status_at timestamptz;
alter table contacts add column if not exists email_status_reason text
  check (email_status_reason is null or char_length(email_status_reason) <= 200);

-- The "needs attention" list: only the unhealthy few are indexed.
create index if not exists contacts_email_attention_idx on contacts (tenant_id, email_status_at desc)
  where email_status in ('soft_bounce', 'bounced', 'complained', 'invalid');

alter table marketing_campaign_recipients add column if not exists resend_id text;
alter table marketing_campaign_recipients add column if not exists delivery_status text
  check (delivery_status is null or delivery_status in ('delivered', 'soft_bounced', 'bounced', 'complained', 'delayed'));
alter table marketing_campaign_recipients add column if not exists delivery_at timestamptz;

create index if not exists marketing_campaign_recipients_resend_idx on marketing_campaign_recipients (resend_id)
  where resend_id is not null;
