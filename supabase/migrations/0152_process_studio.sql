-- 0152: Process Design Studio, phase 1 (docs/process-design-studio-architecture.md).
-- A study is one prospect's or client's account of how they work, mapped,
-- rated against what BPMSquare really does, turned into changes and a plan, and
-- handed to the BPMSquare team. One record (process_studies, STU-####) and its
-- child families; versions are frozen jsonb snapshots, not row history.
--
-- Independent of 0150 (ai_usage_log) and 0151 (platform_settings): the studio
-- degrades without either. The seed scripts/seed-process-studio-demo.sql runs
-- AFTER this file.
--
-- RLS (read this before changing it)
--   Every table is SELECT-ONLY for tenant members. There is no insert/update/
--   delete policy at all: every write goes through a route that uses the
--   service-role client AFTER checking the study is the caller's. A study
--   carries trust claims -- a "Reviewed by BPMSquare" tick, a request status, a
--   fit rating -- and a `for all` policy would let a prospect forge them with
--   their own session token straight through PostgREST (the WFM lesson in
--   MULTI_TENANT_GUARDRAILS.md: check what the module's siblings do before
--   adding the standard policy). This is stricter than the doc's `for all`.
--
--   Visibility: a study is private to its creator on a demo workspace
--   (tenants.is_demo) -- two prospects on the shared demo tenant must never see
--   each other's business. On any other tenant the creator and the tenant's
--   admins see it. process_studio_can_see() is SECURITY DEFINER so the policy
--   can read tenants/tenant_users without depending on those tables' own RLS.
--   Child tables defer to the header: you see a child row if you can see its
--   study. Platform admins read across tenants through the service-role client
--   in /admin/studies, never through these policies.
--
-- Identity (bpmsquarecore.md section 3): every row has its own uuid; child
-- rows key Update/Delete on that id, study_id only resolves the parent at
-- create time.
--
-- Pending-migration behaviour: every route reads 42P01 / 42703 / PGRST205 as
-- "waiting for the database update" -- an empty list, never a crash.

create or replace function process_studio_can_see(p_tenant uuid, p_creator uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
           select 1 from tenant_users tu
           where tu.tenant_id = p_tenant and tu.user_id = auth.uid()
         )
     and (
           p_creator = auth.uid()
        or (
              not coalesce((select t.is_demo from tenants t where t.id = p_tenant), false)
          and exists (
                select 1 from tenant_users tu
                where tu.tenant_id = p_tenant and tu.user_id = auth.uid() and tu.role = 'admin'
              )
         )
     )
$$;

-- ── The study ───────────────────────────────────────────────────────────────
create table if not exists process_studies (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  ref               text,
  name              text not null,
  status            text not null default 'telling'
                      check (status in ('telling','mapped','fit_ready','changes_ready','plan_ready',
                                        'submitted','reviewed','accepted','rescoped','closed')),
  -- The furthest step reached (1..6): steps beyond it are locked in the stepper.
  reached           smallint not null default 1 check (reached between 1 and 6),
  created_by        uuid not null,
  -- {area_id: {off: bool}} -- which guided areas the client switched off.
  areas             jsonb not null default '{}'::jsonb,
  -- Extra lane (role) names the client added; lanes in use come from the steps.
  lanes             jsonb not null default '[]'::jsonb,
  language          text not null default 'en',
  follow_ups        boolean not null default true,
  -- A few plain lines about the business, written by the map step.
  summary           text,
  -- Cross-cutting points from the fit step ("Things we noticed"), plain strings.
  noticed           jsonb not null default '[]'::jsonb,
  plan_start_date   date,
  weekend           text not null default 'fri_sat' check (weekend in ('fri_sat','sat_sun','sun')),
  contact_name      text,
  contact_email     text,                          -- encrypted like contacts (lib/encryption)
  current_version   int not null default 0,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_note       text,
  custom_data       jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists process_studies_tenant_status on process_studies (tenant_id, status, created_at desc);
create index if not exists process_studies_tenant_creator on process_studies (tenant_id, created_by);
create unique index if not exists process_studies_tenant_ref_uniq on process_studies (tenant_id, ref) where ref is not null;

alter table process_studies enable row level security;
drop policy if exists "process_studies: visible to creator or tenant admin" on process_studies;
create policy "process_studies: visible to creator or tenant admin" on process_studies for select
  using (process_studio_can_see(tenant_id, created_by));

-- ── The conversation ────────────────────────────────────────────────────────
create table if not exists process_study_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  study_id    uuid not null references process_studies(id) on delete cascade,
  role        text not null check (role in ('client','studio')),
  area        text,                                 -- set when the text answers a guided area
  text        text not null,
  -- studio turns: [{fact, kind: 'stated'|'assumed'}] and the follow-up questions.
  understood  jsonb not null default '[]'::jsonb,
  questions   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists process_study_messages_study on process_study_messages (tenant_id, study_id, created_at);

-- ── The map ─────────────────────────────────────────────────────────────────
create table if not exists process_study_steps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  study_id    uuid not null references process_studies(id) on delete cascade,
  area        text not null,
  lane        text not null,
  sort_order  int not null default 0,
  name        text not null,
  what        text,
  how_today   text,
  frequency   text,
  assumed     boolean not null default false,
  hands_over  boolean not null default false,       -- passes work to another lane
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists process_study_steps_study on process_study_steps (tenant_id, study_id, sort_order);

-- ── The fit report ──────────────────────────────────────────────────────────
create table if not exists process_study_fit (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  study_id         uuid not null references process_studies(id) on delete cascade,
  step_id          uuid not null references process_study_steps(id) on delete cascade,
  rating           text not null check (rating in ('standard','needs_setup','partly','not_covered','needs_review','coming')),
  capability_ids   text[] not null default '{}',
  why              text not null default '',
  confidence       text not null default 'check_with_us' check (confidence in ('sure','likely','check_with_us')),
  warnings         jsonb not null default '[]'::jsonb,
  reviewed         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (step_id)
);
create index if not exists process_study_fit_study on process_study_fit (tenant_id, study_id);

-- ── Proposed changes ────────────────────────────────────────────────────────
create table if not exists process_study_changes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  study_id      uuid not null references process_studies(id) on delete cascade,
  kind          text not null check (kind in ('setting','own_fields','extension','new_build','integration')),
  title         text not null,
  plain         text not null default '',
  alternative   text,
  effort_band   text not null check (effort_band in ('small','medium','large')),
  step_ids      uuid[] not null default '{}',
  extension_hook text,                              -- a hook name from src/extensions/types.ts, or 'new_hook'
  connector     text,                               -- a connector id, when kind = integration
  kept          boolean not null default true,
  client_added  boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists process_study_changes_study on process_study_changes (tenant_id, study_id, sort_order);

-- ── The plan ────────────────────────────────────────────────────────────────
create table if not exists process_study_tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  study_id      uuid not null references process_studies(id) on delete cascade,
  phase         text not null check (phase in ('foundations','master_data','sales','service_production',
                                               'workforce','customisations','integrations','go_live')),
  sort_order    int not null default 0,
  name          text not null,
  owner         text not null check (owner in ('client','bpmsquare')),
  duration_days int not null default 1 check (duration_days between 1 and 60),
  milestone     boolean not null default false,
  from_template boolean not null default false,
  client_added  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists process_study_tasks_study on process_study_tasks (tenant_id, study_id, phase, sort_order);

-- ── Client comments and the "Looks right" ticks ─────────────────────────────
create table if not exists process_study_comments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  study_id        uuid not null references process_studies(id) on delete cascade,
  phase           text not null,
  task_id         uuid references process_study_tasks(id) on delete cascade,
  text            text,
  phase_ok        boolean,                          -- a tick row: text is null, phase_ok is set
  author_user_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists process_study_comments_study on process_study_comments (tenant_id, study_id, phase);

-- ── Frozen versions ─────────────────────────────────────────────────────────
create table if not exists process_study_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  study_id    uuid not null references process_studies(id) on delete cascade,
  version     int not null,
  reason      text not null check (reason in ('submitted','re-run','manual')),
  snapshot    jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (study_id, version)
);
create index if not exists process_study_versions_study on process_study_versions (tenant_id, study_id, version desc);

-- ── The "Talk to us" hand-off ───────────────────────────────────────────────
create table if not exists process_study_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  study_id      uuid not null references process_studies(id) on delete cascade,
  version       int not null,
  status        text not null default 'new' check (status in ('new','contacted','accepted','rescoped','declined')),
  contact_name  text,
  contact_email text,                               -- encrypted like contacts
  email_status  text not null default 'not_sent' check (email_status in ('not_sent','sent','redirected','failed')),
  email_note    text,
  assigned_to   uuid,
  notes         text,
  applied_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists process_study_requests_status on process_study_requests (tenant_id, status, created_at desc);
create index if not exists process_study_requests_study on process_study_requests (tenant_id, study_id);

-- ── RLS on every child: select-only, through the header ─────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'process_study_messages','process_study_steps','process_study_fit','process_study_changes',
    'process_study_tasks','process_study_comments','process_study_versions','process_study_requests'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || ': visible with its study', t);
    execute format(
      'create policy %I on %I for select using (study_id in (select id from process_studies))',
      t || ': visible with its study', t
    );
  end loop;
end $$;
