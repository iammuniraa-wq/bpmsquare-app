-- custom_fields (migration 0011) supports object_type asset/case/work_order, and their API
-- routes already PATCH custom_data on them, but the column itself was only ever added to
-- accounts/contacts (0010) and quotes (0012) -- never to assets, service_cases, or
-- work_orders. Any attempt to save a custom field value on those three has been failing at
-- the DB level. Adding it now, idempotently, to all three.

alter table assets       add column if not exists custom_data jsonb;
alter table service_cases add column if not exists custom_data jsonb;
alter table work_orders  add column if not exists custom_data jsonb;
