-- 0175: Buying signals shell (docs/signals-architecture.md section 7.2).
-- signal_topics: the subjects a tenant sells ("Precast", "Fire safety"). A
-- newsletter block or link can carry a topic id; a click on a topic-tagged
-- link scores more than a click on an untagged one. Keywords are stored for the
-- later news and tender sources and are not read by the shell.
--
-- RLS: members may SELECT their tenant's topics; there is NO insert/update/
-- delete policy. Topics change what a score is worth, so they are written only
-- by the server routes (service-role client, tenant-filtered, admin-checked) --
-- the WFM / pricing convention in MULTI_TENANT_GUARDRAILS.md, not "for all".
--
-- Additive: one new table. The app treats a missing table as "no topics".

create table if not exists signal_topics (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  keywords    text[] not null default '{}',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists signal_topics_name_idx on signal_topics (tenant_id, lower(name));

alter table signal_topics enable row level security;
drop policy if exists "signal_topics: tenant read" on signal_topics;
create policy "signal_topics: tenant read" on signal_topics for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No write policy on purpose.
