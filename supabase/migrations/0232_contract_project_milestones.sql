-- 0232: the billing schedule of a contract project: invoicing milestones.
-- GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23). Needs 0226 (contract_projects) and the invoices table.
--
-- contract_project_milestones: one row per amount to bill, in order. A title, a due date, the amount as a percent of the (revised)
-- contract value OR a fixed amount, a status (planned, ready, invoiced, paid) and the invoice made from it (invoice_id points at the
-- existing invoices object; "Create invoice" on a milestone makes a draft invoice and stores the link both ways: here, and in the
-- invoice's custom_data). Percent milestones are meant to total at most 100 percent; the screen warns, the database does not block.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. A milestone drives what is billed,
-- so every write is a service-role API route that has already checked the tenant, the project and the caller's access.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Invoicing tab says a database update is needed and
-- nothing else changes (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
  if to_regclass('public.invoices') is null then
    raise exception 'The invoices table is missing. Run the base schema first, then run this again.';
  end if;
end $$;

create table if not exists contract_project_milestones (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  project_id   uuid not null references contract_projects(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  due_date     date,
  basis        text not null default 'percent' check (basis in ('percent', 'fixed')),
  percent      numeric(6,2) check (percent is null or (percent >= 0 and percent <= 100)),
  fixed_amount numeric(14,2) check (fixed_amount is null or fixed_amount >= 0),
  status       text not null default 'planned' check (status in ('planned', 'ready', 'invoiced', 'paid')),
  invoice_id   uuid references invoices(id) on delete set null,
  sort_order   int not null default 0,
  note         text check (note is null or char_length(note) <= 1000),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((basis = 'percent' and percent is not null) or (basis = 'fixed' and fixed_amount is not null))
);

create index if not exists contract_project_milestones_project on contract_project_milestones (tenant_id, project_id, sort_order, due_date);
create unique index if not exists contract_project_milestones_one_invoice on contract_project_milestones (invoice_id) where invoice_id is not null;

alter table contract_project_milestones enable row level security;
drop policy if exists "contract_project_milestones: tenant read" on contract_project_milestones;
create policy "contract_project_milestones: tenant read" on contract_project_milestones for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
