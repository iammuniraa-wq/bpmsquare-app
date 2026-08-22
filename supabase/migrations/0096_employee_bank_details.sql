-- 0096: employee bank details — the portal's "Your Bank Details" tile
-- (PagarBook parity). One row per employee, entered by the employee from
-- their own login (or an admin on their behalf).
--
-- account_number and upi_id are AES-256-GCM encrypted at the app layer
-- (src/lib/encryption.ts) before they ever reach a row -- same treatment as
-- account/contact PII. IFSC and bank/branch names are not secrets.
--
-- RLS: SELECT own row only. Deliberately NOT the own-or-supervisor shape --
-- a supervisor has no business reading bank numbers; tenant ADMINS read
-- through the service-role API routes, which is also where every write goes
-- (no insert/update/delete policy at all, the WFM convention).

create table if not exists employee_bank_details (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  employee_id uuid not null references employees(id) on delete cascade,
  account_holder text,
  bank_name text,
  account_number text,        -- encrypted (enc:v1:…)
  ifsc text,
  upi_id text,                -- encrypted (enc:v1:…)
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_id)
);

alter table employee_bank_details enable row level security;

create policy "employee_bank_details: own row" on employee_bank_details for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = employee_bank_details.tenant_id
        and employee_id is not null
    )
  );
