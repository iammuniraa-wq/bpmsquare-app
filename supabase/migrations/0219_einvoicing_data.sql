-- 0219_einvoicing_data.sql
--
-- Saudi e-invoicing (ZATCA), phase E1 "Data readiness" (docs/design/saudi-einvoicing-plan.md). The data an invoice needs to
-- be MADE READY for e-invoicing; nothing is submitted anywhere (that is E2+). Everything is additive and nullable, so no
-- existing invoice, account or line changes, and a workspace without the platform-admin flag `einvoicing_ksa` never reads
-- or writes any of it.
--
-- 1. accounts (the buyer): VAT number, commercial registration number, Arabic name, buyer type (business | individual),
--    building number, district, and the optional identity of an INDIVIDUAL buyer (buyer_id_number is encrypted by the app
--    with encrypt(), like the other PII on this table; buyer_id_scheme is the ID type, not personal data). Street, city,
--    postal code and country are the generic address columns the account already has.
-- 2. invoices: document type (standard | simplified | credit_note | debit_note), the document UUID, the per-seller-unit
--    counter (einvoice_seq, with einvoice_unit naming the unit), the link to the original invoice of a credit or debit note,
--    the note's reason and the supply date. invoices.issued_at already exists (timestamptz: date AND time).
-- 3. invoice_lines: VAT category (S standard, Z zero, E exempt, O out of scope), VAT rate and the reason for Z/E/O.
-- 4. einvoice_counters + allocate_einvoice_seq(): the gap-free counter. ONE atomic upsert inside the transaction that also
--    writes the number onto the invoice; never read-then-write. Service role only (a member must not be able to burn numbers).
-- 5. A guard trigger: once an invoice has its UUID or counter number nobody can change it, and a member (the session
--    client) can never set the counter by hand. Locking an invoice once ZATCA has cleared it is E3 and is NOT done here.
--
-- The seller unit is an entity inside tenants.config.entities (JSON), so the seller fields (VAT number, CRN, Arabic name,
-- structured address) need no column and no migration; they are typed in TenantEntity (src/lib/constants.ts).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md): accounts, invoices and invoice_lines keep the policies they already have (0000_baseline /
-- 0025), unchanged. The one new table, einvoice_counters, has RLS enabled and a tenant SELECT policy ONLY: the counter is
-- evidence the app maintains, never something a member may write through PostgREST (same lesson as the WFM tables and
-- erp_documents in 0216).
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the app hides every e-invoice field and the
-- readiness check says "Needs a database update"; nothing crashes (42703 / PGRST204 are read as "not there yet").

alter table accounts
  add column if not exists vat_number      text,
  add column if not exists crn             text,
  add column if not exists name_ar         text,
  add column if not exists buyer_type      text check (buyer_type in ('business', 'individual')),
  add column if not exists address_building text,
  add column if not exists address_district text,
  add column if not exists buyer_id_number text,
  add column if not exists buyer_id_scheme text check (buyer_id_scheme in ('NAT', 'IQA', 'PAS', 'GCC', 'OTH'));

alter table invoices
  add column if not exists einvoice_doc_type    text check (einvoice_doc_type in ('standard', 'simplified', 'credit_note', 'debit_note')),
  add column if not exists einvoice_uuid        uuid,
  add column if not exists einvoice_seq         bigint check (einvoice_seq is null or einvoice_seq > 0),
  add column if not exists einvoice_unit        text,
  add column if not exists original_invoice_id  uuid references invoices(id),
  add column if not exists credit_reason        text,
  add column if not exists supply_date          date;

alter table invoice_lines
  add column if not exists vat_category         text check (vat_category in ('S', 'Z', 'E', 'O')),
  add column if not exists vat_rate             numeric(5,2) check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100)),
  add column if not exists vat_exemption_reason text;

create unique index if not exists invoices_einvoice_uuid_uniq
  on invoices (einvoice_uuid) where einvoice_uuid is not null;
create unique index if not exists invoices_einvoice_seq_uniq
  on invoices (tenant_id, coalesce(einvoice_unit, ''), einvoice_seq) where einvoice_seq is not null;
create index if not exists invoices_original_invoice_idx
  on invoices (tenant_id, original_invoice_id) where original_invoice_id is not null;

-- -- The counter ----------------------------------------------------------------------------------------------------------
create table if not exists einvoice_counters (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  seller_key  text not null,                    -- the entity id in tenants.config.entities[] ('' when the workspace has none)
  last_seq    bigint not null default 0 check (last_seq >= 0),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, seller_key)
);

alter table einvoice_counters enable row level security;
drop policy if exists "einvoice_counters: tenant read" on einvoice_counters;
create policy "einvoice_counters: tenant read" on einvoice_counters for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Takes the next number for a seller unit and writes it onto the invoice, in ONE transaction. The upsert locks the counter
-- row until commit, so concurrent callers queue and each gets a different number; a failure after the number is taken rolls
-- the counter back with it, so there is no gap. Calling it again for an invoice that already has a number returns that
-- number and takes nothing.
create or replace function allocate_einvoice_seq(p_tenant uuid, p_invoice uuid, p_seller_key text)
returns bigint
language plpgsql
as $fn$
declare
  v_existing bigint;
  v_next     bigint;
begin
  select einvoice_seq into v_existing
    from invoices where id = p_invoice and tenant_id = p_tenant
    for update;
  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into einvoice_counters (tenant_id, seller_key, last_seq)
    values (p_tenant, coalesce(p_seller_key, ''), 1)
    on conflict (tenant_id, seller_key)
    do update set last_seq = einvoice_counters.last_seq + 1, updated_at = now()
    returning last_seq into v_next;

  update invoices set einvoice_seq = v_next, einvoice_unit = coalesce(p_seller_key, '')
    where id = p_invoice and tenant_id = p_tenant;
  return v_next;
end;
$fn$;

-- Only the server (service role) takes numbers. A member's session token must not be able to call this from PostgREST
-- and burn numbers on draft invoices.
revoke all on function allocate_einvoice_seq(uuid, uuid, text) from public;
revoke all on function allocate_einvoice_seq(uuid, uuid, text) from anon, authenticated;
grant execute on function allocate_einvoice_seq(uuid, uuid, text) to service_role;

-- -- The guard ------------------------------------------------------------------------------------------------------------
-- Once set, the UUID and the counter number never change. The counter is set by the server only: a member's own session
-- (role authenticated) cannot write it, even though invoices otherwise allow member updates. A connection with no JWT claims
-- (the SQL editor, a migration) is treated as the server.
create or replace function invoices_einvoice_guard()
returns trigger
language plpgsql
as $fn$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'service_role'
  );
begin
  if tg_op = 'INSERT' then
    if v_role <> 'service_role' and (new.einvoice_seq is not null or new.einvoice_unit is not null) then
      raise exception 'The e-invoice counter is allocated by the server only' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.einvoice_uuid is not null and new.einvoice_uuid is distinct from old.einvoice_uuid then
    raise exception 'The e-invoice UUID cannot be changed once it is set' using errcode = '42501';
  end if;
  if old.einvoice_seq is not null
     and (new.einvoice_seq is distinct from old.einvoice_seq or new.einvoice_unit is distinct from old.einvoice_unit) then
    raise exception 'The e-invoice counter number cannot be changed once it is set' using errcode = '42501';
  end if;
  if v_role <> 'service_role' and old.einvoice_seq is null and new.einvoice_seq is not null then
    raise exception 'The e-invoice counter is allocated by the server only' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists invoices_einvoice_guard on invoices;
create trigger invoices_einvoice_guard
  before insert or update on invoices
  for each row execute function invoices_einvoice_guard();
