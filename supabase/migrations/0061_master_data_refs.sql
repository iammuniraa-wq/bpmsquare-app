-- 0061_master_data_refs.sql
-- Human-readable business IDs for master data. Transactional objects have
-- always had a visible ref (QT-/SQ-/INV- etc.); master data was addressable
-- only by UUID + name, so there was no "ACC-0001" a user could quote on the
-- phone, print, or match against an ERP. Adds a tenant-scoped sequential ref
-- to the five master-data tables and backfills existing rows per tenant in
-- creation order (contacts/assets have no created_at column, so they
-- backfill in name order -- stable and human-sensible, and the sequence
-- carries no meaning beyond identity).
--
-- The ref is DISPLAY/REFERENCE ONLY. The UUID `id` remains the one and only
-- key for update/delete/API access, per bpmsquarecore.md §3 -- a ref is
-- never accepted as a mutation key anywhere.

alter table accounts        add column ref text;
alter table contacts        add column ref text;
alter table assets          add column ref text;
alter table suppliers       add column ref text;
alter table inventory_items add column ref text;

with numbered as (
  select id, row_number() over (partition by tenant_id order by created_at, id) as rn from accounts
)
update accounts t set ref = 'ACC-' || lpad(n.rn::text, 4, '0') from numbered n where t.id = n.id and t.ref is null;

with numbered as (
  select id, row_number() over (partition by tenant_id order by name, id) as rn from contacts
)
update contacts t set ref = 'CON-' || lpad(n.rn::text, 4, '0') from numbered n where t.id = n.id and t.ref is null;

with numbered as (
  select id, row_number() over (partition by tenant_id order by name, id) as rn from assets
)
update assets t set ref = 'AST-' || lpad(n.rn::text, 4, '0') from numbered n where t.id = n.id and t.ref is null;

with numbered as (
  select id, row_number() over (partition by tenant_id order by created_at, id) as rn from suppliers
)
update suppliers t set ref = 'SUP-' || lpad(n.rn::text, 4, '0') from numbered n where t.id = n.id and t.ref is null;

with numbered as (
  select id, row_number() over (partition by tenant_id order by created_at, id) as rn from inventory_items
)
update inventory_items t set ref = 'INV-' || lpad(n.rn::text, 4, '0') from numbered n where t.id = n.id and t.ref is null;

-- Partial unique indexes: refs never collide within a tenant; rows whose ref
-- is somehow still null (shouldn't happen after backfill) don't block.
create unique index accounts_tenant_ref_uniq        on accounts (tenant_id, ref)        where ref is not null;
create unique index contacts_tenant_ref_uniq        on contacts (tenant_id, ref)        where ref is not null;
create unique index assets_tenant_ref_uniq          on assets (tenant_id, ref)          where ref is not null;
create unique index suppliers_tenant_ref_uniq       on suppliers (tenant_id, ref)       where ref is not null;
create unique index inventory_items_tenant_ref_uniq on inventory_items (tenant_id, ref) where ref is not null;
