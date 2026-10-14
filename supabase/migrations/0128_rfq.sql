-- 0128: RFQ -- request for quotation as a standard, flag-scoped object
-- (docs/rfq-architecture.md). Owner decision 2026-10-14: RFQ is a core
-- product object behind the `rfq` feature flag, raised wherever a price or
-- cost cannot be found (Standard Quotes, deals, Quotations, cases,
-- inspection reports, work orders, fence projects, or by hand), and the
-- whole supplier conversation -- sending AND receiving -- lives inside the
-- tenant, not in someone's mailbox.
--
-- Shape (SAP's collective RFQ, Odoo's call for tender):
--   rfqs            one request, many lines, many suppliers   (RFQ-####)
--   rfq_lines       what is asked; product optional so a free-text,
--                   engineered one-off can be asked about too
--   rfq_suppliers   one recipient per supplier, each with its own signed
--                   no-login reply link (token_nonce rotates to revoke)
--   rfq_responses   one price per supplier per line
--   rfq_messages    the conversation: outbound email, inbound email
--                   (routed by a signed reply-to address), portal replies
--
-- RLS: SELECT-only for tenant members, no write policy. Supplier prices are
-- commercially sensitive and drive cost, so every write goes through the
-- service-role routes, which filter by tenant_id explicitly -- the same
-- posture pricing_rfqs already has (0113) and the WFM lesson in
-- MULTI_TENANT_GUARDRAILS.md.
--
-- Pending-migration behaviour: every route degrades on 42P01 (empty list /
-- 503 with a message), and the legacy pricing_rfqs flow keeps working for
-- tenants without the flag.

create table if not exists rfqs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  ref                text,
  title              text not null,
  status             text not null default 'draft'
                       check (status in ('draft','sent','partially_replied','replied','awarded','closed','cancelled')),
  origin_type        text not null default 'manual'
                       check (origin_type in ('manual','standard_quote','quote','opportunity','case','inspection_report','work_order','fence_project','pricing')),
  origin_id          uuid,
  origin_label       text,
  requested_by       uuid,
  buyer_id           uuid,
  respond_by         date,
  required_by        date,
  delivery_terms     text,
  currency           text,
  notes_to_supplier  text,
  notes_internal     text,
  custom_data        jsonb,
  legacy_pricing_rfq_id uuid unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists rfqs_tenant_ref_uniq on rfqs (tenant_id, ref) where ref is not null;
create index if not exists rfqs_tenant_status on rfqs (tenant_id, status, created_at desc);
create index if not exists rfqs_tenant_origin on rfqs (tenant_id, origin_type, origin_id);

alter table rfqs enable row level security;
drop policy if exists "rfqs: tenant read" on rfqs;
create policy "rfqs: tenant read" on rfqs for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists rfq_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  rfq_id              uuid not null references rfqs(id) on delete cascade,
  sl_no               int not null default 1,
  product_id          uuid references products(id) on delete set null,
  description         text not null,
  spec                text,
  uom                 text,
  qty                 numeric(14,3),
  required_by         date,
  status              text not null default 'open'
                        check (status in ('open','awarded','no_award','cancelled')),
  awarded_response_id uuid,
  awarded_unit_cost   numeric(14,4),  -- in tenant currency, after FX
  cost_input_id       uuid references pricing_cost_inputs(id) on delete set null,
  cost_model_code     text,
  path                text not null default 'purchase.unit_cost',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists rfq_lines_rfq on rfq_lines (tenant_id, rfq_id, sl_no);
create index if not exists rfq_lines_product on rfq_lines (tenant_id, product_id) where product_id is not null;

alter table rfq_lines enable row level security;
drop policy if exists "rfq_lines: tenant read" on rfq_lines;
create policy "rfq_lines: tenant read" on rfq_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists rfq_suppliers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  rfq_id             uuid not null references rfqs(id) on delete cascade,
  supplier_id        uuid not null references suppliers(id) on delete cascade,
  email_to           text,
  contact_name       text,
  status             text not null default 'pending'
                       check (status in ('pending','sent','viewed','replied','declined','expired','cancelled')),
  token_nonce        text not null default replace(gen_random_uuid()::text, '-', ''),
  link_expires_at    timestamptz,
  sent_at            timestamptz,
  viewed_at          timestamptz,
  replied_at         timestamptz,
  reminder_count     int not null default 0,
  last_reminded_at   timestamptz,
  supplier_quote_ref text,
  currency           text,
  incoterm           text,
  freight_amount     numeric(14,2),
  payment_terms      text,
  valid_until        date,
  note               text,
  reply_source       text check (reply_source in ('link','buyer','upload','email')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

create index if not exists rfq_suppliers_tenant_rfq on rfq_suppliers (tenant_id, rfq_id);
create index if not exists rfq_suppliers_tenant_supplier on rfq_suppliers (tenant_id, supplier_id);
create index if not exists rfq_suppliers_reminders on rfq_suppliers (status, sent_at) where status in ('sent','viewed');

alter table rfq_suppliers enable row level security;
drop policy if exists "rfq_suppliers: tenant read" on rfq_suppliers;
create policy "rfq_suppliers: tenant read" on rfq_suppliers for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists rfq_responses (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  rfq_supplier_id     uuid not null references rfq_suppliers(id) on delete cascade,
  rfq_line_id         uuid not null references rfq_lines(id) on delete cascade,
  status              text not null default 'quoted'
                        check (status in ('quoted','no_quote','alternative')),
  unit_price          numeric(14,4),
  currency            text,
  fx_rate             numeric(14,6),
  lead_time_days      int,
  moq                 numeric(14,3),
  offered_description text,
  valid_until         date,
  note                text,
  source              text not null default 'buyer' check (source in ('link','buyer','upload','email')),
  is_awarded          boolean not null default false,
  submitted_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (rfq_supplier_id, rfq_line_id)
);

create index if not exists rfq_responses_line on rfq_responses (tenant_id, rfq_line_id);

alter table rfq_responses enable row level security;
drop policy if exists "rfq_responses: tenant read" on rfq_responses;
create policy "rfq_responses: tenant read" on rfq_responses for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table rfq_lines drop constraint if exists rfq_lines_awarded_response_fk;
alter table rfq_lines add constraint rfq_lines_awarded_response_fk
  foreign key (awarded_response_id) references rfq_responses(id) on delete set null;

create table if not exists rfq_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  rfq_id              uuid not null references rfqs(id) on delete cascade,
  rfq_supplier_id     uuid references rfq_suppliers(id) on delete set null,
  direction           text not null check (direction in ('out','in','note')),
  channel             text not null check (channel in ('email','portal','system','whatsapp')),
  from_address        text,
  to_addresses        text[],
  subject             text,
  body_text           text,
  message_id          text,
  in_reply_to         text,
  provider            text,
  provider_message_id text,
  attachments         jsonb not null default '[]'::jsonb,  -- [{path, filename, content_type, size}]
  status              text not null default 'sent'
                        check (status in ('sent','failed','received','redirected','logged')),
  error               text,
  created_by          uuid,
  read_at             timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists rfq_messages_rfq on rfq_messages (tenant_id, rfq_id, created_at);
create index if not exists rfq_messages_unread on rfq_messages (tenant_id, direction, read_at) where direction = 'in' and read_at is null;
-- A provider retries a webhook it didn't get a 2xx for; the same inbound
-- message must land once.
create unique index if not exists rfq_messages_provider_uniq
  on rfq_messages (tenant_id, provider, provider_message_id) where provider_message_id is not null;

alter table rfq_messages enable row level security;
drop policy if exists "rfq_messages: tenant read" on rfq_messages;
create policy "rfq_messages: tenant read" on rfq_messages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Line contract: a document line remembers the RFQ line it asked about ───
-- (docs/sales-engine-architecture.md §3.1). The client carries it across
-- saves exactly like product_id; the server verifies it belongs to the
-- tenant before writing it.
alter table standard_quote_lines add column if not exists rfq_line_id uuid references rfq_lines(id) on delete set null;
alter table opportunity_lines    add column if not exists rfq_line_id uuid references rfq_lines(id) on delete set null;
alter table quote_lines          add column if not exists rfq_line_id uuid references rfq_lines(id) on delete set null;

-- ── Backfill: every legacy pricing_rfqs row becomes a one-line RFQ ─────────
-- Keeps its ref, so RFQ-0007 is still RFQ-0007 and the new object's
-- sequence continues from it. Idempotent through legacy_pricing_rfq_id.
insert into rfqs (tenant_id, ref, title, status, origin_type, origin_id, origin_label,
                  requested_by, notes_to_supplier, legacy_pricing_rfq_id, created_at, updated_at)
select p.tenant_id, p.ref,
       coalesce(pr.name, 'Product'),
       case p.status when 'replied' then 'awarded' when 'sent' then 'sent' when 'cancelled' then 'cancelled' else 'draft' end,
       case when p.standard_quote_id is not null then 'standard_quote'
            when p.quote_id is not null then 'quote'
            when p.opportunity_id is not null then 'opportunity'
            else 'pricing' end,
       coalesce(p.standard_quote_id, p.quote_id, p.opportunity_id),
       null,
       p.requested_by, p.message, p.id, p.created_at, p.updated_at
from pricing_rfqs p
left join products pr on pr.id = p.product_id
on conflict (legacy_pricing_rfq_id) do nothing;

insert into rfq_lines (tenant_id, rfq_id, sl_no, product_id, description, uom, qty, status,
                       cost_model_code, path, cost_input_id, awarded_unit_cost, created_at, updated_at)
select r.tenant_id, r.id, 1, p.product_id, coalesce(pr.name, 'Product'), p.uom, p.quantity,
       case p.status when 'replied' then 'awarded' when 'cancelled' then 'cancelled' else 'open' end,
       p.cost_model_code, p.path, p.cost_input_id, p.reply_value, p.created_at, p.updated_at
from pricing_rfqs p
join rfqs r on r.legacy_pricing_rfq_id = p.id
left join products pr on pr.id = p.product_id
where not exists (select 1 from rfq_lines l where l.rfq_id = r.id);

insert into rfq_suppliers (tenant_id, rfq_id, supplier_id, email_to, status, sent_at, replied_at,
                           currency, valid_until, note, reply_source, created_at, updated_at)
select r.tenant_id, r.id, p.supplier_id, p.sent_to,
       case p.status when 'replied' then 'replied' when 'sent' then 'sent' when 'cancelled' then 'cancelled' else 'pending' end,
       p.sent_at, p.replied_at, p.reply_currency, p.reply_valid_to, p.reply_note,
       case when p.status = 'replied' then 'buyer' else null end,
       p.created_at, p.updated_at
from pricing_rfqs p
join rfqs r on r.legacy_pricing_rfq_id = p.id
where p.supplier_id is not null
on conflict (rfq_id, supplier_id) do nothing;

insert into rfq_responses (tenant_id, rfq_supplier_id, rfq_line_id, status, unit_price, currency, fx_rate,
                           valid_until, note, source, is_awarded, submitted_at, updated_at)
select r.tenant_id, s.id, l.id, 'quoted', p.reply_value, p.reply_currency, 1,
       p.reply_valid_to, p.reply_note, 'buyer', true, coalesce(p.replied_at, p.updated_at), p.updated_at
from pricing_rfqs p
join rfqs r on r.legacy_pricing_rfq_id = p.id
join rfq_suppliers s on s.rfq_id = r.id and s.supplier_id = p.supplier_id
join rfq_lines l on l.rfq_id = r.id
where p.status = 'replied' and p.reply_value is not null
on conflict (rfq_supplier_id, rfq_line_id) do nothing;

update rfq_lines l
set awarded_response_id = x.id
from rfq_responses x
where x.rfq_line_id = l.id and x.is_awarded and l.awarded_response_id is null;

-- ── Mailbox mode: where the inbox poller got to, per tenant mailbox ────────
-- A tenant can run RFQ email through its OWN mailbox (Gmail or any
-- SMTP/IMAP server, Settings -> Connectors) instead of the platform sender.
-- The poller remembers the last IMAP UID it read so each run only fetches
-- new mail; uid_validity changing means the server renumbered the mailbox
-- and the poller restarts from "recent" rather than trusting old UIDs.
-- Service-role only (no policy at all): it is plumbing, not user data.
create table if not exists rfq_mailbox_state (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  connector_id   text not null,
  uid_validity   bigint,
  last_uid       bigint not null default 0,
  last_polled_at timestamptz,
  last_error     text,
  primary key (tenant_id, connector_id)
);

alter table rfq_mailbox_state enable row level security;
