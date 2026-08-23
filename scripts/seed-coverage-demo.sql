-- Sample Coverage setup for the DEMO tenant (run AFTER 0101_coverage.sql).
-- Mirrors the proposal deck's own worked example: regional pods, a hospital
-- vertical, and an AMC service desk. Idempotent -- skips any team/segment
-- whose name/code already exists for the tenant, safe to re-run. Also turns
-- the coverage_model feature on for the demo tenant.
--
-- Lead/members use the demo tenant's own tenant_users rows (there's no
-- "Ravi"/"Priya"/"Meena" to seed as real auth.users) -- whichever admin
-- exists first becomes every demo team's lead, and every existing member
-- joins every demo team, so the demo shows populated teams without
-- inventing fake logins.

with demo as (select id from tenants where is_demo = true limit 1),
     lead as (select tu.user_id from tenant_users tu, demo where tu.tenant_id = demo.id and tu.role = 'admin' order by tu.created_at limit 1)
insert into teams (tenant_id, name, lead_user_id)
select demo.id, v.name, lead.user_id
from demo, lead,
(values ('South Pod'), ('Hospital Specialists'), ('AMC Service Desk')) as v(name)
where not exists (select 1 from teams t where t.tenant_id = demo.id and t.name = v.name);

with demo as (select id from tenants where is_demo = true limit 1)
insert into team_members (tenant_id, team_id, user_id)
select demo.id, t.id, tu.user_id
from demo
join teams t on t.tenant_id = demo.id and t.name in ('South Pod', 'Hospital Specialists', 'AMC Service Desk')
join tenant_users tu on tu.tenant_id = demo.id
where not exists (select 1 from team_members tm where tm.team_id = t.id and tm.user_id = tu.user_id);

with demo as (select id from tenants where is_demo = true limit 1)
insert into segments (tenant_id, code, name, filters, match)
select demo.id, v.code, v.name, v.filters::jsonb, v.match
from demo,
(values
  ('SOUTH', 'South region',
    '[{"id":"f1","field":"state","operator":"equals","value":"Karnataka"},{"id":"f2","field":"state","operator":"equals","value":"Tamil Nadu"},{"id":"f3","field":"state","operator":"equals","value":"Kerala"}]',
    'any'),
  ('HOSPITALS', 'Healthcare vertical',
    '[{"id":"f1","field":"industry","operator":"equals","value":"Healthcare"}]',
    'all'),
  ('AMC_BASE', 'Active AMC base',
    '[{"id":"f1","field":"has_active_amc","operator":"is_true","value":""}]',
    'all')
) as v(code, name, filters, match)
where not exists (select 1 from segments s where s.tenant_id = demo.id and s.code = v.code);

with demo as (select id from tenants where is_demo = true limit 1)
insert into coverages (tenant_id, segment_id, team_id, role, priority)
select demo.id, s.id, t.id, v.role, 100
from demo
join (values ('SOUTH', 'South Pod', 'owner'), ('HOSPITALS', 'Hospital Specialists', 'overlay'), ('AMC_BASE', 'AMC Service Desk', 'service'))
  as v(segment_code, team_name, role) on true
join segments s on s.tenant_id = demo.id and s.code = v.segment_code
join teams t on t.tenant_id = demo.id and t.name = v.team_name
where not exists (
  select 1 from coverages c where c.tenant_id = demo.id and c.segment_id = s.id and c.team_id = t.id and c.role = v.role
);

update tenants
set features = coalesce(features, '{}'::jsonb) || '{"coverage_model": true}'::jsonb
where is_demo = true;
