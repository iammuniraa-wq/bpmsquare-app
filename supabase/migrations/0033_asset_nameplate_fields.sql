-- Asset nameplate fields — core product, all tenants.
--
-- Motor/generator nameplate spec fields that were referenced in the Asset
-- type / print config (rpm) but never had a real column, plus the rest of
-- a standard nameplate (see FIELD_REGISTRY_ROLLOUT.md). All nullable text,
-- matching how make/model/serial/rating already store spec values.

alter table assets add column if not exists rpm                text;
alter table assets add column if not exists frame_type         text;
alter table assets add column if not exists insulation_class   text;
alter table assets add column if not exists connection         text;
alter table assets add column if not exists duty               text;
alter table assets add column if not exists ambient_temp       text;
alter table assets add column if not exists output_kw          text;
alter table assets add column if not exists stator_voltage     text;
alter table assets add column if not exists stator_current     text;
alter table assets add column if not exists excitation_voltage text;
alter table assets add column if not exists excitation_current text;
alter table assets add column if not exists frequency          text;
