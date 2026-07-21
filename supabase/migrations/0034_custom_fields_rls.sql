-- custom_fields has existed since migration 0011 with a tenant_id column but was
-- never given RLS -- enable row level security and add a policy anywhere.
-- Not currently exploitable (every route that touches this table filters by
-- tenant_id in application code), but there was zero database-level backstop:
-- one future query anywhere that forgot the manual filter would be a full
-- cross-tenant read/write of every tenant's custom field *definitions*
-- (schema-level, not just data). Same pattern as field_overrides/field_rules
-- (migration 0030), which got this right from the start.

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_fields: tenant isolation" ON custom_fields FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
