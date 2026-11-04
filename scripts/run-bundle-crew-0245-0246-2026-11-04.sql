-- Bundle: AI automation (docs/design/nova-crew-agents.md), written 2026-11-04. Run on the dev database, then the production database(s) (KAMCO's included).
-- Contains, verbatim and in order: 0245_crew_foundation.sql, 0246_crew_event_cursor.sql. Idempotent; safe to run twice.
-- Then, on the DEMO workspace only, run scripts/seed-crew-demo.sql. Nothing in the product changes for a workspace until a platform admin switches
-- on the flags crew / crew_tender_watch / crew_attendance in /admin/tenants (all default OFF).

-- AI automation, slice S1 (docs/design/nova-crew-agents.md, section 3.2): the foundation tables shared by every pre-built agent
-- (Tender Watch, Attendance Anomalies). A workspace tunes an agent in crew_agent_settings; a run is both the task queue and the
-- run record (crew_runs); crew_steps is the trace; crew_findings is what a person reads; crew_proposals is the approval gate.
--
-- RLS stance (deliberately stricter than "tenant-member SELECT", MULTI_TENANT_GUARDRAILS.md, the 0062 / 0078 / 0199 lessons):
--   crew_agent_settings  tenant-member SELECT, NO write policy. It holds no personal data; writes are admin API routes on the
--                        service role (with logChange).
--   crew_runs, crew_steps, crew_findings, crew_proposals   RLS enabled, NO policy at all (service role only). The attendance rows
--                        are WFM-adjacent personal data whose rule is own-row-or-supervisor, which a policy cannot express for a
--                        recursive supervisor tree; and a member who could write a finding or a proposal through PostgREST could
--                        forge a "review suggestion" about a colleague or an approvable action. Every read is a route that applies
--                        the viewer's scope.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the AI automation page says a database update is
-- needed and the cron skips the workspace (42P01 / PGRST205 are read as "not there yet"). No new column on `tenants`.

create table if not exists crew_agent_settings (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  agent_key         text not null check (agent_key in ('tender_watch', 'attendance', '_workspace')),
  enabled           boolean not null default false,
  -- Per-agent pause. On the '_workspace' row this is the "Pause all agents" switch.
  paused            boolean not null default false,
  config            jsonb not null default '{}'::jsonb,
  -- Written only by the platform-admin route. Null = the agent definition's default.
  monthly_token_cap int check (monthly_token_cap is null or monthly_token_cap >= 0),
  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, agent_key)
);

create table if not exists crew_runs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  agent_key        text not null check (agent_key in ('tender_watch', 'attendance')),
  trigger          text not null check (trigger in ('schedule', 'event', 'manual')),
  -- The "Because" shown on the Runs tab ("Daily pass", "Bid decision proposed").
  trigger_ref      text,
  scope            jsonb not null default '{}'::jsonb,
  -- Ids the model may ask about; a foreign id is a tool error, not data.
  candidates       jsonb not null default '[]'::jsonb,
  dedupe_key       text not null,
  status           text not null default 'queued'
                     check (status in ('queued', 'running', 'done', 'failed', 'skipped_budget', 'skipped_paused', 'cancelled')),
  attempt          int not null default 0,
  locked_until     timestamptz,
  model            text,
  prompt_version   text,
  input_tokens     int not null default 0,
  output_tokens    int not null default 0,
  turns            int not null default 0,
  tool_calls       int not null default 0,
  findings_count   int not null default 0,
  proposals_count  int not null default 0,
  nothing_to_report text,
  -- Compact facts used by the next run to say what changed (addenda count, BOQ version).
  snapshot         jsonb,
  -- Attendance only: alias -> employee id. Service role only, never shown to the model.
  alias_map        jsonb,
  error            text,
  requested_by     uuid,
  queued_at        timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  purge_after      date,
  created_at       timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

create index if not exists crew_runs_queue_idx on crew_runs (status, queued_at) where status in ('queued', 'running');
create index if not exists crew_runs_tenant_idx on crew_runs (tenant_id, agent_key, created_at desc);
create index if not exists crew_runs_purge_idx on crew_runs (purge_after) where purge_after is not null;

create table if not exists crew_steps (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  run_id     uuid not null references crew_runs(id) on delete cascade,
  seq        int not null,
  kind       text not null check (kind in ('plan', 'prefetch', 'tool', 'model', 'validate', 'gate')),
  name       text not null,
  input      jsonb,
  -- Size-capped and aliased by the runner.
  output     jsonb,
  -- [{type, id, label}] so the trace can link the records it looked at.
  refs       jsonb not null default '[]'::jsonb,
  ok         boolean not null default true,
  error      text,
  tokens_in  int not null default 0,
  tokens_out int not null default 0,
  ms         int not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists crew_steps_tenant_idx on crew_steps (tenant_id, run_id);

create table if not exists crew_findings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  run_id         uuid references crew_runs(id) on delete set null,
  agent_key      text not null check (agent_key in ('tender_watch', 'attendance')),
  kind           text not null,
  severity       text not null check (severity in ('info', 'review', 'urgent')),
  subject_type   text not null,
  subject_id     text not null,
  site_id        uuid,
  -- Already rendered from the templates by the server.
  title          text not null,
  body           text not null,
  -- [{step, path, label, href}]
  evidence       jsonb not null default '[]'::jsonb,
  gaps           jsonb not null default '[]'::jsonb,
  fingerprint    text not null,
  recipient_ids  uuid[] not null default '{}',
  status         text not null default 'open' check (status in ('open', 'seen', 'dismissed', 'not_an_issue', 'actioned', 'expired')),
  status_by      uuid,
  status_at      timestamptz,
  status_note    text,
  suppress_until date,
  last_seen_at   timestamptz not null default now(),
  purge_after    date,
  created_at     timestamptz not null default now()
);

-- An open or seen finding with the same fingerprint is not created twice.
create unique index if not exists crew_findings_open_fp_uniq on crew_findings (tenant_id, fingerprint) where status in ('open', 'seen');
create index if not exists crew_findings_list_idx on crew_findings (tenant_id, agent_key, status, created_at desc);
create index if not exists crew_findings_suppress_idx on crew_findings (tenant_id, fingerprint) where suppress_until is not null;
create index if not exists crew_findings_purge_idx on crew_findings (purge_after) where purge_after is not null;

create table if not exists crew_proposals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  finding_id     uuid references crew_findings(id) on delete set null,
  run_id         uuid references crew_runs(id) on delete set null,
  agent_key      text not null check (agent_key in ('tender_watch', 'attendance')),
  action_key     text not null check (action_key in ('tender.nudge', 'wfm.recheck')),
  target_type    text not null,
  target_id      text not null,
  payload        jsonb not null default '{}'::jsonb,
  edited_payload jsonb,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'failed', 'done')),
  approver_ids   uuid[] not null default '{}',
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  executed_at    timestamptz,
  result         jsonb,
  fingerprint    text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create unique index if not exists crew_proposals_pending_fp_uniq on crew_proposals (tenant_id, fingerprint) where status = 'pending';
create index if not exists crew_proposals_list_idx on crew_proposals (tenant_id, agent_key, status, created_at desc);
create index if not exists crew_proposals_finding_idx on crew_proposals (finding_id) where finding_id is not null;

alter table crew_agent_settings enable row level security;
alter table crew_runs           enable row level security;
alter table crew_steps          enable row level security;
alter table crew_findings       enable row level security;
alter table crew_proposals      enable row level security;

drop policy if exists "crew_agent_settings: tenant read" on crew_agent_settings;
create policy "crew_agent_settings: tenant read" on crew_agent_settings for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- crew_runs, crew_steps, crew_findings, crew_proposals: no policy on purpose (deny by default; service role only).

-- AI automation, slice S2 (docs/design/nova-crew-agents.md, sections 3.3 and 3.10): the per-workspace bookmark through which the
-- plan cron consumes domain_event (0137), the same shape as journey_cursors (0167). The lease stops two overlapping cron ticks
-- from both advancing the cursor for one workspace.
--
-- RLS enabled, NO policy: only the service-role cron touches it. Idempotent; safe to run twice. Hand-applied by the owner: until
-- it runs the plan cron simply does not wake agents from events (the daily pass is unaffected).

create table if not exists crew_cursors (
  tenant_id       uuid primary key references tenants(id) on delete cascade,
  last_created_at timestamptz,
  last_event_id   uuid,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

alter table crew_cursors enable row level security;
-- No policy on purpose (deny by default; service role only).
