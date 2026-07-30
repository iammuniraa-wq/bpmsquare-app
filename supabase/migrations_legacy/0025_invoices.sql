-- Migration 0025: full invoicing -- extend invoices, add invoice_lines + invoice_payments,
-- widen custom_fields.object_type.
--
-- invoices/work_orders already carry tenant_id live (schema.sql is the source of truth,
-- 0001_init.sql is stale) -- this only ALTERs the existing invoices table, it does not
-- recreate it. RLS is (re)established defensively below even though invoices already accepts
-- inserts via the session client today -- no tracked migration ever proved a full policy set
-- exists, and enabling/creating policies is idempotent, so there's no reason to leave it to
-- chance.

alter table invoices
  add column if not exists contact_id     text,          -- matches quotes.contact_id exactly (text, no FK)
  add column if not exists quote_id       uuid references quotes(id) on delete set null,
  add column if not exists case_id        uuid references service_cases(id) on delete set null,
  add column if not exists contract_id    uuid references contracts(id) on delete set null,
  add column if not exists entity_id      text,          -- matches quotes.entity_id: a JSONB-array id in tenants.config.entities[]
  add column if not exists due_date       date,
  add column if not exists discount_type  text not null default 'pct',
  add column if not exists discount_pct   numeric(5,2) not null default 0,
  add column if not exists discount_fixed numeric(14,2) not null default 0,
  add column if not exists notes          text,
  add column if not exists terms          text,
  add column if not exists custom_data    jsonb,
  add column if not exists paid_amount    numeric(12,2) not null default 0,
  add column if not exists created_by     uuid,
  add column if not exists created_at     timestamptz not null default now();

-- Widen status: draft/sent/paid/overdue existed; add partial (payments ledger needs it) and
-- cancelled (every other billable object already has a terminal cancel state).
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('draft','sent','partial','paid','overdue','cancelled'));

create unique index if not exists invoices_tenant_ref_uniq on invoices (tenant_id, ref);
create index if not exists invoices_tenant_idx on invoices (tenant_id);
create index if not exists invoices_tenant_account_idx on invoices (tenant_id, account_id);
create index if not exists invoices_quote_idx on invoices (quote_id);

alter table invoices enable row level security;
drop policy if exists "tenant members can read invoices" on invoices;
drop policy if exists "tenant members can insert invoices" on invoices;
drop policy if exists "tenant members can update invoices" on invoices;
drop policy if exists "tenant members can delete invoices" on invoices;
create policy "tenant members can read invoices" on invoices for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert invoices" on invoices for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update invoices" on invoices for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete invoices" on invoices for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  sl_no       text,          -- text, matches quote_lines.sl_no exactly -- invoice lines are usually a verbatim copy of quote_lines
  description text not null,
  uom         text,
  qty         numeric(10,2) not null default 1,
  rate        numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);

create table if not exists invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  method     text,          -- free text: cash / cheque / bank transfer / UPI -- no enum, no gateway integration
  reference  text,          -- cheque no. / UTR / txn id
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_idx on invoice_payments (invoice_id);

alter table invoice_lines enable row level security;
alter table invoice_payments enable row level security;

create policy "tenant members can read invoice_lines" on invoice_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert invoice_lines" on invoice_lines for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update invoice_lines" on invoice_lines for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete invoice_lines" on invoice_lines for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "tenant members can read invoice_payments" on invoice_payments for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert invoice_payments" on invoice_payments for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update invoice_payments" on invoice_payments for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete invoice_payments" on invoice_payments for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table custom_fields drop constraint if exists custom_fields_object_type_check;
alter table custom_fields add constraint custom_fields_object_type_check
  check (object_type in ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order','invoice'));
