-- 0209_standard_quotes_custom_data.sql
--
-- bpmsquarecore section 3b (new-object checklist): Standard Quotes had no
-- custom_data column, so a tenant could not add its own fields to a standard
-- quote the way it can on every other user-facing object. This adds the one
-- column; tenant-defined fields (custom_fields.object_type = 'standard_quote',
-- keys prefixed cf_) are stored in it.
--
-- RLS is unchanged: standard_quotes already has its tenant-isolation policy
-- (0053) and a new column falls under it. Idempotent. The app degrades
-- cleanly while this is pending: the write routes drop the column and retry,
-- the readers treat a missing column as "no custom values".

alter table standard_quotes add column if not exists custom_data jsonb;
