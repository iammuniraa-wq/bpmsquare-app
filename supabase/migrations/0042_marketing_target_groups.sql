-- Reusable, named audience definitions built from the same account_types +
-- include/exclude + manual-email rule already used ad hoc per campaign, so a
-- rep can save "All OEM + Direct minus X" once (from existing master data)
-- and load it into a new campaign instead of re-specifying every time.
create table marketing_target_groups (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  name                 text not null,
  account_types        text[] not null default '{}',
  include_account_ids  text[] not null default '{}',
  exclude_account_ids  text[] not null default '{}',
  manual_emails        text[] not null default '{}',  -- raw emails not tied to any account row
  created_by           uuid,
  created_at           timestamptz not null default now()
);

create index marketing_target_groups_tenant_idx on marketing_target_groups (tenant_id, created_at desc);

alter table marketing_target_groups enable row level security;

create policy "marketing_target_groups: tenant isolation" on marketing_target_groups for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Campaigns can additionally target raw email addresses that aren't tied to
-- any account in the system (e.g. a contact only known outside BPMSquare).
alter table marketing_campaigns add column if not exists manual_emails text[] not null default '{}';

-- A campaign recipient may be a manually-entered email with no account row
-- behind it, so account_id can no longer be mandatory.
alter table marketing_campaign_recipients alter column account_id drop not null;
alter table marketing_campaign_recipients add column if not exists manual_email text;
alter table marketing_campaign_recipients add constraint marketing_campaign_recipients_target_check
  check (account_id is not null or manual_email is not null);
