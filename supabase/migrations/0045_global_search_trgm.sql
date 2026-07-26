-- Global search: trigram GIN indexes so `ILIKE '%term%'` substring search
-- (the query pattern the search API uses across every object) stays fast at
-- scale instead of degrading to a sequential scan per table. pg_trgm is a
-- standard, built-in Postgres extension -- no new architecture, just an
-- index type.
create extension if not exists pg_trgm;

create index if not exists accounts_name_trgm_idx          on accounts using gin (name gin_trgm_ops);
create index if not exists contacts_name_trgm_idx           on contacts using gin (name gin_trgm_ops);
create index if not exists assets_name_trgm_idx             on assets using gin (name gin_trgm_ops);
create index if not exists assets_serial_trgm_idx           on assets using gin (serial gin_trgm_ops);
create index if not exists service_cases_ref_trgm_idx       on service_cases using gin (ref gin_trgm_ops);
create index if not exists service_cases_equip_trgm_idx     on service_cases using gin (equipment_label gin_trgm_ops);
create index if not exists quotes_ref_trgm_idx              on quotes using gin (ref gin_trgm_ops);
create index if not exists work_orders_ref_trgm_idx         on work_orders using gin (ref gin_trgm_ops);
create index if not exists purchase_orders_ref_trgm_idx     on purchase_orders using gin (ref gin_trgm_ops);
create index if not exists invoices_ref_trgm_idx            on invoices using gin (ref gin_trgm_ops);
create index if not exists inventory_items_name_trgm_idx    on inventory_items using gin (name gin_trgm_ops);
create index if not exists inventory_items_sku_trgm_idx     on inventory_items using gin (sku gin_trgm_ops);
create index if not exists suppliers_name_trgm_idx          on suppliers using gin (name gin_trgm_ops);
create index if not exists leads_title_trgm_idx             on leads using gin (title gin_trgm_ops);
