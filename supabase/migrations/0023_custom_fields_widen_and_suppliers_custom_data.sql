-- Migration 0023: widen custom_fields.object_type to cover the new objects (+ suppliers,
-- which had zero custom-fields support until now), and add custom_data to suppliers.

alter table custom_fields drop constraint if exists custom_fields_object_type_check;
alter table custom_fields add constraint custom_fields_object_type_check
  check (object_type in ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order'));

alter table suppliers add column if not exists custom_data jsonb;
