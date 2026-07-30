-- Custom fields system: tenant-defined fields on any object.
-- Values are stored in the custom_data JSONB column on each record.

CREATE TABLE IF NOT EXISTS custom_fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type  text NOT NULL CHECK (object_type IN ('account','contact','case','quote','work_order','asset')),
  field_key    text NOT NULL,               -- auto-generated: cf_<label_slug>
  field_label  text NOT NULL,
  field_type   text NOT NULL CHECK (field_type IN ('text','number','date','select','checkbox','textarea')),
  field_section text,                       -- which form section: e.g. "Identity", "Address"
  options      text[],                      -- for select type
  is_required  boolean NOT NULL DEFAULT false,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, object_type, field_key)
);

CREATE INDEX IF NOT EXISTS custom_fields_tenant_object ON custom_fields (tenant_id, object_type);
