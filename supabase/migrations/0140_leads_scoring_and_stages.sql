-- 0140_leads_scoring_and_stages.sql
-- Marketing platform phase M0 (docs/marketing-platform-architecture.md 1.1, 4):
--  * the columns a scored lead needs: person, owner, score + the working,
--    when it was scored, the response deadline, last activity, custom fields,
--    and the status-engine link;
--  * the lead lifecycle on the existing status engine (0070): 'leads' becomes
--    a legal entity_type and its eight plain stages are seeded as system
--    statuses.
--
-- Additive. leads.status (new / inspecting / quoted / won / lost / converted)
-- is NOT touched and stays what every existing screen and route reads and
-- writes. The eight stages sit beside it: a lead that has never been through
-- the new flow reads its stage from `status` by the mapping in
-- src/lib/marketing/leadStages.ts (inspecting and quoted -> working,
-- converted -> deal, won -> customer, lost -> not now). Nothing is rewritten
-- here, and every new column is nullable, so the Vikas leads list and the
-- convert route behave exactly as before.
--
-- Everything that reads or writes the new columns is behind the tenant flag
-- features.marketing_scoring (platform-admin set, default off).
--
-- Not added yet: source_form_id and source_event_id (the forms and events
-- tables they would point at arrive in M4 and M8; they ship with those).
--
-- RLS: leads already has its tenant-isolation policy (0000_baseline); new
-- columns inherit it. The status-engine tables keep theirs.

-- ── leads columns ────────────────────────────────────────────────────────────
alter table leads add column if not exists contact_id uuid references contacts(id) on delete set null;
alter table leads add column if not exists owner_user_id uuid;
alter table leads add column if not exists score integer check (score is null or (score between 0 and 100));
-- The factors that produced the score and the rubric version in force, so
-- "why 72?" is answered with what was true then.
alter table leads add column if not exists score_factors jsonb;
alter table leads add column if not exists scored_at timestamptz;
alter table leads add column if not exists sla_due_at timestamptz;
alter table leads add column if not exists last_activity_at timestamptz;
alter table leads add column if not exists custom_data jsonb;
alter table leads add column if not exists custom_status_id uuid references custom_status(id) on delete set null;

create index if not exists leads_tenant_score_idx on leads (tenant_id, score desc) where score is not null;
create index if not exists leads_tenant_owner_idx on leads (tenant_id, owner_user_id) where owner_user_id is not null;
create index if not exists leads_tenant_contact_idx on leads (tenant_id, contact_id) where contact_id is not null;

-- ── 'leads' as a status-engine entity ────────────────────────────────────────
-- The entity_type CHECK on these four tables was written inline in 0070, so
-- it carries a Postgres-generated name. Rather than trust that name, drop
-- whichever CHECK on each table mentions entity_type, then re-create it with
-- 'leads' added.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('system_status'::regclass, 'status_profile'::regclass, 'custom_status'::regclass, 'status_history'::regclass)
      and pg_get_constraintdef(oid) like '%entity_type%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table system_status add constraint system_status_entity_type_check check (entity_type in (
  'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
  'inventory', 'suppliers', 'standard_quotes', 'technicians',
  'attendance', 'leave_request', 'leads'
));

alter table status_profile add constraint status_profile_entity_type_check check (entity_type in (
  'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
  'inventory', 'suppliers', 'standard_quotes', 'technicians',
  'attendance', 'leave_request', 'leads'
));

alter table custom_status add constraint custom_status_entity_type_check check (entity_type in (
  'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
  'inventory', 'suppliers', 'standard_quotes', 'technicians',
  'attendance', 'leave_request', 'leads'
));

alter table status_history add constraint status_history_entity_type_check check (entity_type in (
  'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
  'inventory', 'suppliers', 'standard_quotes', 'technicians',
  'attendance', 'leave_request', 'leads'
));

-- The eight plain stages (docs/marketing-platform-architecture.md 4.2).
-- Deal, Customer and Not a fit end the lead's own story; Not now can recycle.
insert into system_status (entity_type, code, label, sort_order, is_terminal) values
  ('leads', 'NEW',      'New',             0, false),
  ('leads', 'ENGAGED',  'Engaged',         1, false),
  ('leads', 'READY',    'Ready for sales', 2, false),
  ('leads', 'WORKING',  'Working',         3, false),
  ('leads', 'DEAL',     'Deal',            4, true),
  ('leads', 'CUSTOMER', 'Customer',        5, true),
  ('leads', 'NOT_NOW',  'Not now',         6, false),
  ('leads', 'NOT_FIT',  'Not a fit',       7, true)
on conflict (entity_type, code) do nothing;
