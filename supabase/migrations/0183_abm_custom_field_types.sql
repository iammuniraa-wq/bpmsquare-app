-- 0183: custom fields on the three ABM objects (docs/abm-architecture.md section 11).
-- Same widening 0128 and 0131 did: every object the app offers custom fields on,
-- plus the three ABM ones. NOT VALID so an existing row of some object this
-- list does not know can never make the migration fail half-way. The list is a
-- superset of 0131's, and includes process_study and newsletter so this file
-- cannot narrow what another studio's migration allowed.

alter table custom_fields drop constraint if exists custom_fields_object_type_check;
alter table custom_fields add constraint custom_fields_object_type_check
  check (object_type in ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order','invoice',
                         'employee','product','project','opportunity','rfq','estimate','process_study','newsletter',
                         'abm_program','abm_target','abm_member')) not valid;
