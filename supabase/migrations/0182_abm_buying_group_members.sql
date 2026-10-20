-- 0182: Account-Based Marketing, buying group members (docs/abm-architecture.md section 3.3).
-- A person's role in one target account, for one program. Roles live here and
-- not on the contact: the same person can be the decision maker for one
-- program and an influencer for another. Requires 0181.
--
-- Naming someone in a buying group is an internal business record. It sends
-- nothing and needs no marketing consent; every send is gated elsewhere by
-- canContact(). Engagement per member is NOT stored here: it is read from
-- domain_event at render time.
--
-- `notes` is a rep's private note about a person. It never leaves the app:
-- not in the v1 API, not in LIST_SOURCES, not in MCP.

create table if not exists abm_buying_group_members (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  target_account_id  uuid not null references abm_target_accounts(id) on delete cascade,
  contact_id         uuid not null references contacts(id) on delete cascade,
  role               text not null default 'unknown'
    check (role in ('decision_maker', 'influencer', 'user', 'blocker', 'unknown')),
  is_primary         boolean not null default false,
  -- Who on our side knows this person (the relationship owner).
  owner_user_id      uuid,
  notes              text,
  added_by           uuid,
  added_via          text not null default 'manual' check (added_via in ('manual', 'suggested', 'import')),
  custom_data        jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists abm_members_target_contact_key on abm_buying_group_members (tenant_id, target_account_id, contact_id);
create index if not exists abm_members_tenant_target on abm_buying_group_members (tenant_id, target_account_id);
create index if not exists abm_members_tenant_contact on abm_buying_group_members (tenant_id, contact_id);
-- At most one primary person per target account.
create unique index if not exists abm_members_one_primary on abm_buying_group_members (tenant_id, target_account_id) where is_primary;

alter table abm_buying_group_members enable row level security;
drop policy if exists "abm_buying_group_members: tenant isolation" on abm_buying_group_members;
create policy "abm_buying_group_members: tenant isolation" on abm_buying_group_members for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
