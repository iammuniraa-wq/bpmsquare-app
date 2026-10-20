-- 0190: the touches ledger (docs/marketing-platform-architecture.md section 8, docs/shells/attribution-shell.md).
-- One row per marketing contact with a person or company, DERIVED from the domain_event stream by the
-- attribution cron: a click on a campaign or newsletter, a form submission, a journey entry, a WhatsApp
-- message, an event registration. Nothing writes here from a screen; it is a read model of events that
-- already happened, and it never changes a deal.
--
-- `source_event_id` + `asset_type` is unique, so reading the same event twice (a retried cron, a lost
-- cursor) writes nothing twice. `asset_id` is the campaign, newsletter, form, journey, WhatsApp template or
-- marketing event; it has no foreign key on purpose (an asset can be deleted, the touch is still history).
--
-- RLS: SELECT-ONLY for members. A touch is a claim about what a customer did; a member who could write it
-- through PostgREST could invent credit for a campaign (the WFM lesson in MULTI_TENANT_GUARDRAILS.md). The
-- cron writes on the service-role client with the tenant on every query.

create table if not exists marketing_touches (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  source_event_id  uuid not null,
  asset_type       text not null check (asset_type in ('campaign', 'newsletter', 'form', 'journey', 'whatsapp', 'event')),
  asset_id         uuid not null,
  -- engaged = the person did something (click, reply, signed up); reached = they were only sent something.
  strength         text not null check (strength in ('engaged', 'reached')),
  account_id       uuid,
  contact_id       uuid,
  lead_id          uuid,
  occurred_at      timestamptz not null,
  created_at       timestamptz not null default now()
);

create unique index if not exists marketing_touches_event_uniq on marketing_touches (tenant_id, source_event_id, asset_type);
create index if not exists marketing_touches_account_idx on marketing_touches (tenant_id, account_id, occurred_at);
create index if not exists marketing_touches_asset_idx on marketing_touches (tenant_id, asset_type, asset_id);

alter table marketing_touches enable row level security;
drop policy if exists "marketing_touches: tenant read" on marketing_touches;
create policy "marketing_touches: tenant read" on marketing_touches for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No insert/update/delete policy on purpose.
