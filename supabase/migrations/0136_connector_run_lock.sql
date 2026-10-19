-- 0136: one running sync per entity (D365 connector review H5, 2026-10-19).
--
-- A manual "Sync now" during the hourly cron run of the same entity used to
-- race it: two runs creating the same records (the twins C2 describes). The
-- sync code already checks for a running run before it starts one; this index
-- is what makes that check atomic -- the second concurrent insert is rejected
-- (23505) and the loser reports "already running" instead of syncing twice.
--
-- The code works without this index (it keeps the check, only the atomicity
-- is lost), so applying it is not a prerequisite for deploying the code.
--
-- Runs a killed function left in 'running' would block the index forever, so
-- they are closed first. The sync code does the same on every start (a run
-- older than 10 minutes cannot still be alive: the routes stop at 300 s).
-- Where more than one 'running' row exists for the same entity right now,
-- only the newest is kept as running, or the index could not be created.
--
-- RLS: unchanged (select-only for tenant members, 0129). No new table.

update connector_sync_runs
   set status = 'failed',
       finished_at = coalesce(finished_at, now()),
       error = coalesce(error, 'The run did not finish (the server stopped it). The next run continues.')
 where status = 'running'
   and (
     started_at < now() - interval '10 minutes'
     or id not in (
       select distinct on (tenant_id, connector_id, entity) id
         from connector_sync_runs
        where status = 'running'
        order by tenant_id, connector_id, entity, started_at desc
     )
   );

create unique index if not exists connector_sync_runs_one_running
  on connector_sync_runs (tenant_id, connector_id, entity)
  where status = 'running';
