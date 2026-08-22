-- 0099: Product sub-category (owner decision 2026-08-22).
-- Categories are tenant CONFIG, not free text: the client defines their own
-- category tree in Settings -> Sales config (tenants.config.product_categories),
-- and out of the box we support two levels — category and sub-category.
-- Deeper hierarchies are a roadmap item, which is why this is a plain second
-- column rather than a parent-pointer table: two levels is the OOB contract.
-- No RLS change needed — products' existing tenant-isolation policy covers
-- the new column.

alter table products add column if not exists sub_category text;
