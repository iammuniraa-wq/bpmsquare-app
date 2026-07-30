-- Migration 0026: multi-asset support on cases + a separate symptom field.
--
-- asset_ids is the full list (mirrors quotes.asset_ids' exact text[] pattern for consistency).
-- asset_id stays as-is (nullable FK) and is kept in sync as the "primary" (first) asset, so
-- every existing read site that joins on the single asset_id keeps working unmodified.

alter table service_cases
  add column if not exists asset_ids text[] not null default '{}',
  add column if not exists symptom text;

update service_cases set asset_ids = array[asset_id::text]
  where asset_id is not null and asset_ids = '{}';
