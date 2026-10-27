-- 0233: supplier groups: a client's approved vendor list.
-- GCC tender deals, contract buy-out (docs/design/contract-buyout.md sections 0b and 4). Needs 0120 (accounts, suppliers).
--
-- supplier_groups: a named list of suppliers (for example "Aramco approved vendors"), optionally linked to ONE client account. When a tender
-- deal or a contract project belongs to that account, the supplier pickers of its RFQs offer only the group's members, and the server refuses
-- anyone else (strict, no override). An account without a group, or with an inactive or empty one, means all suppliers. A client account has at
-- most one group per workspace (unique index below); a group may also have no account (a general list kept for later).
-- supplier_group_members: the suppliers in a group; one row per pair.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. A group steers which suppliers a
-- tender may be sent to, so a member must not be able to edit one through PostgREST; every write is a service-role API route that has
-- already checked the tenant, the caller's Suppliers grant, and that the account and every supplier belong to the workspace.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Groups tab says a database update is needed and every
-- supplier picker offers all suppliers as before (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.suppliers') is null or to_regclass('public.accounts') is null then
    raise exception 'Run the accounts and suppliers migrations first, then run this again.';
  end if;
end $$;

create table if not exists supplier_groups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  account_id  uuid references accounts(id) on delete set null,
  note        text check (note is null or char_length(note) <= 1000),
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists supplier_groups_tenant_name_uniq on supplier_groups (tenant_id, lower(name));
create unique index if not exists supplier_groups_one_per_account on supplier_groups (tenant_id, account_id) where account_id is not null;

alter table supplier_groups enable row level security;
drop policy if exists "supplier_groups: tenant read" on supplier_groups;
create policy "supplier_groups: tenant read" on supplier_groups for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists supplier_group_members (
  group_id    uuid not null references supplier_groups(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (group_id, supplier_id)
);

create index if not exists supplier_group_members_supplier_idx on supplier_group_members (tenant_id, supplier_id);

alter table supplier_group_members enable row level security;
drop policy if exists "supplier_group_members: tenant read" on supplier_group_members;
create policy "supplier_group_members: tenant read" on supplier_group_members for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
