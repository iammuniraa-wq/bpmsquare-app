-- 0069_quote_status_is_closed.sql
-- QuoteStatusDef's is_terminal/is_lost pair collapses into one is_closed
-- flag. Win/loss meaning now belongs entirely to `outcome` (open/won/lost/
-- dropped, 0036 + 0068), independent of the pipeline status -- a status
-- just says whether the quote is closed, not which way it closed.
--
-- quote_statuses is tenant-configurable and lives inside tenants.config
-- JSONB (falls back to DEFAULT_QUOTE_STATUSES in code when absent), so this
-- is a data backfill, not a schema change: every tenant that has already
-- customised their pipeline in Settings needs its stored status defs
-- rewritten from the old flags to the new one.

update tenants
set config = jsonb_set(
  config,
  '{quote_statuses}',
  (
    select jsonb_agg(
      (elem - 'is_terminal' - 'is_lost') ||
      case when (elem->>'is_terminal')::boolean is true
           then jsonb_build_object('is_closed', true)
           else '{}'::jsonb
      end
    )
    from jsonb_array_elements(config->'quote_statuses') as elem
  )
)
where config ? 'quote_statuses'
  and jsonb_typeof(config->'quote_statuses') = 'array';
