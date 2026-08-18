-- Employee custom fields (owner request 2026-08-18, BIM Infotech UAT):
-- employees joins the custom-fields family exactly like the ten CRM
-- objects -- definitions in custom_fields (object_type 'employee'), values
-- in a custom_data JSONB on the record. The column simply never existed
-- because employees post-dates the custom-fields build.
alter table employees add column if not exists custom_data jsonb;
