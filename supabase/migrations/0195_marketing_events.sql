-- 0195: marketing events (docs/marketing-platform-architecture.md section 9, docs/shells/events-shell.md).
-- A webinar, exhibition, roadshow or site visit people can register for. Registration goes through an existing
-- Form (0170): attach a form to the event and every submission of it registers the person (0196).
--
-- `form_id` and `follow_up_journey_id` have NO foreign key on purpose: this table must not depend on the forms or
-- journeys migrations having run, and the app re-checks both against the workspace before it uses them
-- (a live form and a live journey of the same tenant, loaded by id AND tenant).
--
-- RLS: the standard tenant-isolation policy ("for all"): an event is a record edited by its users, like an
-- opportunity. The trust-bearing rows are the registrations (0196), which are select-only.
--
-- Pending-migration behaviour: every screen reads 42P01 / 42703 / PGRST205 as "nothing there yet".

create table if not exists marketing_events (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  ref                   text,                                  -- EVT-0001, MASTER_REF_TABLES
  name                  text not null,
  kind                  text not null default 'webinar' check (kind in ('webinar', 'exhibition', 'roadshow', 'site_visit')),
  status                text not null default 'draft' check (status in ('draft', 'open', 'closed', 'completed', 'cancelled')),
  starts_at             timestamptz not null,
  ends_at               timestamptz,
  venue                 text,
  link                  text,                                  -- https join or map link
  capacity              int check (capacity is null or capacity > 0),
  description           text,
  -- The registration form, and the journey a follow-up starts (both optional, both re-checked by the app).
  form_id               uuid,
  follow_up_journey_id  uuid,
  follow_up_on          text not null default 'attended' check (follow_up_on in ('attended', 'no_show')),
  owner_user_id         uuid,
  custom_data           jsonb,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists marketing_events_tenant_idx on marketing_events (tenant_id, starts_at desc);
create index if not exists marketing_events_form_idx on marketing_events (tenant_id, form_id) where form_id is not null;
create unique index if not exists marketing_events_tenant_ref_uniq on marketing_events (tenant_id, ref) where ref is not null;

alter table marketing_events enable row level security;
drop policy if exists "marketing_events: tenant isolation" on marketing_events;
create policy "marketing_events: tenant isolation" on marketing_events for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
