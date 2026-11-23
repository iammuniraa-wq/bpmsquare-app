-- 0259: Site receipts (docs/design/pcbs-site-receipt-expenses.md, section 3). Needs 0258 (site_files) and 0226 (contract projects).
-- Hidden behind the platform-admin flag `site_receipts` (default off).
--
-- 1. site_receipts: one confirmation that a delivery physically arrived. SRC-#### ref. client_id is the phone's idempotency key (unique per
--    workspace). A confirmed receipt is immutable: a manager cancels it with a reason and the site person enters it again (logged). The ERP side
--    is stored apart (erp_ref, erp_state) and filled by the register today and the ERP later. A receipt creates NO cost.
-- 2. site_receipt_lines: what was counted, per item. accepted + rejected = received (checked here as well as in the route). element_code,
--    building and line_key are NULLABLE PLAIN FIELDS with no foreign key: the element master (decision 11, built by another piece of work)
--    does not exist yet, and a receipt must work with or without it.
--
-- RLS: SELECT only, like 0258 and the WFM tables (a receipt is evidence; a member must not forge one through PostgREST). site_receipts is
-- readable by whoever received it and by a workspace admin; the lists and pickers the app draws read through the service role. No insert /
-- update / delete policy exists: every write is a service-role route that has checked the tenant, the project, the package and the caller.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the module stays empty and says a database update is needed.

do $$
begin
  if to_regclass('public.site_files') is null then
    raise exception 'Run 0258 (site expenses) first, then run this again.';
  end if;
end $$;

create table if not exists site_receipts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  ref                text,
  project_id         uuid not null references contract_projects(id) on delete cascade,
  client_id          uuid not null,
  status             text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  package_id         uuid,
  delivery_note_ref  text check (delivery_note_ref is null or char_length(delivery_note_ref) <= 100),
  source_type        text not null default 'manual' check (source_type in ('erp_delivery_note', 'package', 'email', 'manual')),
  source_id          uuid,
  received_at        timestamptz not null default now(),
  received_by        uuid not null,
  handed_by          text check (handed_by is null or char_length(handed_by) <= 200),
  vehicle            text check (vehicle is null or char_length(vehicle) <= 100),
  note               text check (note is null or char_length(note) <= 1000),
  outcome            text not null default 'complete' check (outcome in ('complete', 'partial', 'rejected')),
  cancel_reason      text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  cancelled_by       uuid,
  cancelled_at       timestamptz,
  erp_ref            text check (erp_ref is null or char_length(erp_ref) <= 100),
  erp_state          text not null default 'not_sent' check (erp_state in ('not_sent', 'sent', 'posted', 'failed')),
  sent_at            timestamptz,
  custom_data        jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists site_receipts_client_uniq on site_receipts (tenant_id, client_id);
create unique index if not exists site_receipts_tenant_ref_uniq on site_receipts (tenant_id, ref) where ref is not null;
create index if not exists site_receipts_project_idx on site_receipts (tenant_id, project_id, received_at desc);
create index if not exists site_receipts_package_idx on site_receipts (tenant_id, package_id) where package_id is not null;
create index if not exists site_receipts_note_idx on site_receipts (tenant_id, project_id, delivery_note_ref) where delivery_note_ref is not null;

create table if not exists site_receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  receipt_id    uuid not null references site_receipts(id) on delete cascade,
  line_no       int not null default 0,
  line_key      uuid,
  element_code  text check (element_code is null or char_length(element_code) <= 80),
  building      text check (building is null or char_length(building) <= 80),
  description   text not null check (char_length(description) between 1 and 300),
  uom           text check (uom is null or char_length(uom) <= 30),
  qty_expected  numeric(14,3) check (qty_expected is null or qty_expected >= 0),
  qty_received  numeric(14,3) not null check (qty_received >= 0),
  qty_accepted  numeric(14,3) not null check (qty_accepted >= 0),
  qty_rejected  numeric(14,3) not null default 0 check (qty_rejected >= 0),
  condition     text not null default 'ok' check (condition in ('ok', 'damaged', 'wrong_item', 'defective')),
  reason_code   text check (reason_code is null or char_length(reason_code) <= 40),
  note          text check (note is null or char_length(note) <= 500),
  check (abs(qty_accepted + qty_rejected - qty_received) < 0.0005)
);
create index if not exists site_receipt_lines_receipt_idx on site_receipt_lines (tenant_id, receipt_id, line_no);
create index if not exists site_receipt_lines_key_idx on site_receipt_lines (tenant_id, line_key) where line_key is not null;

alter table site_receipts enable row level security;
drop policy if exists "site_receipts: receiver or admin read" on site_receipts;
create policy "site_receipts: receiver or admin read" on site_receipts for select
  using (received_by = auth.uid() or tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

alter table site_receipt_lines enable row level security;
drop policy if exists "site_receipt_lines: tenant read" on site_receipt_lines;
create policy "site_receipt_lines: tenant read" on site_receipt_lines for select
  using (receipt_id in (select id from site_receipts where received_by = auth.uid() or tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin')));
