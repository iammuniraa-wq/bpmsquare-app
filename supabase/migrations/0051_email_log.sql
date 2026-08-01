-- 0051_email_log.sql
-- Outbound email audit trail: every email BPMSquare actually attempts to
-- send (quote emails, marketing campaign sends), success or failure, in one
-- tenant-wide place -- same "append-only audit table written from API
-- routes" shape as change_log (0050), for the same reason: today there is
-- no single place to answer "did this email go out, to whom, when, and did
-- it succeed" without opening a specific quote or campaign.
--
-- Deliberately NOT a foreign key to quotes/marketing_campaigns -- the source
-- record can be deleted later and the log must survive that, same principle
-- as change_log.object_label. related_object_label captures the
-- human-readable reference (quote ref / campaign name) at send time.
--
-- PII note: to_email is a real recipient address, stored in plaintext here.
-- This matches existing precedent (marketing_campaign_recipients.email,
-- migration 0040) rather than encryption.ts's account/contact PII fields --
-- an email log's entire purpose is showing who a message was sent to, and
-- it's an audit table with its own RLS, not a customer-record field.

create table email_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('quote', 'campaign')),
  to_email text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  related_object_type text,
  related_object_id uuid,
  related_object_label text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);

create index email_log_tenant_time_idx on email_log (tenant_id, created_at desc);
create index email_log_related_idx on email_log (tenant_id, related_object_type, related_object_id);

alter table email_log enable row level security;

create policy "email_log: tenant read" on email_log for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "email_log: tenant insert" on email_log for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
