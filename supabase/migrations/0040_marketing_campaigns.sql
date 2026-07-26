-- Marketing campaigns: a rich-text email sent to a filtered/hand-picked set
-- of accounts at once (festival greetings, promos, etc.) -- distinct from
-- the per-quote email (single recipient, transactional) and the on-demand
-- ERP push (single record, not an email). See src/lib/marketing.ts.

alter table accounts add column if not exists marketing_opt_out boolean not null default false;

create table marketing_campaigns (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  name              text not null,
  subject           text not null,
  body              text not null default '',       -- sanitized HTML (RichTextEditor + sanitizeRichText)
  status            text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  account_types     text[] not null default '{}',    -- e.g. {direct,end_customer} -- matches accounts.type
  include_account_ids text[] not null default '{}',  -- manually added, regardless of account_types
  exclude_account_ids text[] not null default '{}',  -- manually removed from the account_types match
  sent_count        int not null default 0,
  failed_count      int not null default 0,
  skipped_count      int not null default 0,          -- opted-out / no email on file
  created_by        uuid,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);

create index marketing_campaigns_tenant_idx on marketing_campaigns (tenant_id, created_at desc);

alter table marketing_campaigns enable row level security;

create policy "marketing_campaigns: tenant isolation" on marketing_campaigns for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Per-recipient send record -- audit trail + what actually happened, since a
-- campaign's own account_types/include/exclude only describe the *intended*
-- audience at send time, not who a given send actually reached.
create table marketing_campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  campaign_id  uuid not null references marketing_campaigns(id) on delete cascade,
  account_id   uuid not null references accounts(id) on delete cascade,
  email        text,                                  -- resolved send-to address, null if skipped for having none
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped_opt_out', 'skipped_no_email')),
  error        text,
  sent_at      timestamptz
);

create index marketing_campaign_recipients_campaign_idx on marketing_campaign_recipients (campaign_id);

alter table marketing_campaign_recipients enable row level security;

create policy "marketing_campaign_recipients: tenant isolation" on marketing_campaign_recipients for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
