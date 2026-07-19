-- Field customization system, pilot phase (accounts + contacts).
--
-- Two new tables, both purely additive — nothing here alters custom_fields
-- or any existing table, so the other 8 custom-fields-enabled objects
-- (case, quote, work_order, asset, supplier, inventory, purchase_order,
-- invoice) are completely unaffected; no rows are ever written for those
-- object_type values this phase.
--
--   field_overrides — tenant-level rename / hide / section / position for
--     ANY field on ANY object, standard (registry-defined key, e.g.
--     "phone2") or custom (custom_fields.field_key, e.g. "cf_warranty").
--     One row per (tenant, object_type, field_key); absence of a row means
--     "use the registry/custom_fields default".
--   field_rules — SAP C4C-style conditional hide/show/require/optional
--     rules. Full AND/OR condition tree stored as JSONB (shape is the
--     ConditionNode union in src/lib/fieldRegistry.ts) rather than
--     normalized rule/group/condition tables — nothing needs to query
--     individual conditions, and a JSONB tree keeps the whole rule a single
--     atomic read/write unit for the Adapt drawer's rule builder.
--
-- object_type CHECK constraints intentionally include all 10 values used by
-- custom_fields today, so a future batch can extend this to the other 8
-- objects without a constraint-widening migration (custom_fields itself had
-- to be widened twice — 0023, 0025 — for exactly this reason).

CREATE TABLE IF NOT EXISTS field_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN
    ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order','invoice')),
  field_key   text NOT NULL,
  label       text,
  is_hidden   boolean,
  section     text,
  position    integer,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, object_type, field_key)
);

CREATE INDEX IF NOT EXISTS field_overrides_tenant_object ON field_overrides (tenant_id, object_type);

ALTER TABLE field_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "field_overrides: tenant isolation" ON field_overrides FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS field_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type       text NOT NULL CHECK (object_type IN
    ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order','invoice')),
  target_field_key  text NOT NULL,
  effect            text NOT NULL CHECK (effect IN ('hide','show','require','optional')),
  conditions        jsonb NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  position          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_rules_tenant_object ON field_rules (tenant_id, object_type);
CREATE INDEX IF NOT EXISTS field_rules_target_field ON field_rules (tenant_id, object_type, target_field_key);

ALTER TABLE field_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "field_rules: tenant isolation" ON field_rules FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
