-- Fix a real cross-Price-Book isolation bug found 2026-09-06 while building
-- the Catalog + Formula technique (docs/pricing-engine-architecture.md §19).
--
-- pricing_config_versions is correctly scoped per (tenant_id, pricing_area,
-- version) -- but the FOUR tables that actually hold a version's content
-- (pricing_components, pricing_procedures, pricing_rules, pricing_cost_models)
-- were created (0083) with only `config_version int`, no `pricing_area` at
-- all. Every read and write of them (src/lib/pricing/server.ts,
-- api/settings/pricing-engine/{config,versions/[version]}) filtered by
-- (tenant_id, config_version) alone. Since every new Price Book starts at
-- version 1, ANY two Price Books at the same version number -- which is the
-- common case, not an edge case -- silently pool their components,
-- procedures, rules and cost models together at pricing time. Worse: DELETE
-- .../versions/[version] (the wizard's "Discard" button) deletes from these
-- four tables by (tenant_id, config_version) alone too, so discarding one
-- area's draft can destroy ANOTHER area's rows that happen to share the same
-- version number -- including a PUBLISHED or SUPERSEDED version, which the
-- route's own comment says must be immutable history.
--
-- Reproduced live: a fresh "Catalog + Formula" book's fallback formula
-- (ctx.cost.material.rate_per_unit, meant to read its own cost model's
-- value of 10) instead read 850 -- the Default Cost-based book's OWN
-- material.rate_per_unit, from its superseded v1 -- because both config
-- versions were numbered 1 and pricing_cost_models has no area column.
--
-- Fix: add pricing_area to all four tables, backfill it correctly for
-- existing rows, widen the uniqueness/lookup keys to include it, and scope
-- every query in the same piece of work (see the route/server.ts changes in
-- this commit). No tenant has ever gone live on more than one Price Book at
-- a time in production, so the backfill below is the only data at risk --
-- it is a generic "as of" join (which area's version N was most recently
-- created before this row), not hardcoded to any one tenant's timestamps.

alter table pricing_components  add column if not exists pricing_area text not null default 'default';
alter table pricing_procedures  add column if not exists pricing_area text not null default 'default';
alter table pricing_rules       add column if not exists pricing_area text not null default 'default';
alter table pricing_cost_models add column if not exists pricing_area text not null default 'default';

-- Backfill: attribute every existing row to whichever (tenant, area) version
-- row was the most recently created at-or-before this row's own created_at,
-- among versions sharing this row's version NUMBER for this tenant. A tenant
-- that has only ever used "default" (every tenant except the demo tenant,
-- per the architecture doc's as-built baseline) is unaffected -- the join
-- always resolves to its one and only area and the column default already
-- matches it.
update pricing_components c set pricing_area = v.pricing_area
from lateral (
  select pcv.pricing_area from pricing_config_versions pcv
  where pcv.tenant_id = c.tenant_id and pcv.version = c.config_version and pcv.created_at <= c.created_at
  order by pcv.created_at desc limit 1
) v;

update pricing_procedures c set pricing_area = v.pricing_area
from lateral (
  select pcv.pricing_area from pricing_config_versions pcv
  where pcv.tenant_id = c.tenant_id and pcv.version = c.config_version and pcv.created_at <= c.created_at
  order by pcv.created_at desc limit 1
) v;

update pricing_rules c set pricing_area = v.pricing_area
from lateral (
  select pcv.pricing_area from pricing_config_versions pcv
  where pcv.tenant_id = c.tenant_id and pcv.version = c.config_version and pcv.created_at <= c.created_at
  order by pcv.created_at desc limit 1
) v;

update pricing_cost_models c set pricing_area = v.pricing_area
from lateral (
  select pcv.pricing_area from pricing_config_versions pcv
  where pcv.tenant_id = c.tenant_id and pcv.version = c.config_version and pcv.created_at <= c.created_at
  order by pcv.created_at desc limit 1
) v;

-- Widen the keys that used to assume config_version alone was enough to
-- scope a Price Book's content -- so this exact bug can never come back at
-- the schema level, even if an app-code query someday forgets the filter
-- again (defense in depth, same posture as every RLS policy in this file).
alter table pricing_components drop constraint if exists pricing_components_tenant_id_config_version_code_key;
alter table pricing_components add constraint pricing_components_tenant_area_version_code_key
  unique (tenant_id, pricing_area, config_version, code);

alter table pricing_procedures drop constraint if exists pricing_procedures_tenant_id_config_version_code_key;
alter table pricing_procedures add constraint pricing_procedures_tenant_area_version_code_key
  unique (tenant_id, pricing_area, config_version, code);

alter table pricing_cost_models drop constraint if exists pricing_cost_models_tenant_id_config_version_code_key;
alter table pricing_cost_models add constraint pricing_cost_models_tenant_area_version_code_key
  unique (tenant_id, pricing_area, config_version, code);

drop index if exists pricing_rules_lookup;
create index if not exists pricing_rules_lookup
  on pricing_rules (tenant_id, pricing_area, config_version, component_code);
