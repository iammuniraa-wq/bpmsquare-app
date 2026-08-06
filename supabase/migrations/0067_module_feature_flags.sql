-- 0067_module_feature_flags.sql
-- Per-item subscription flags for the eleven nav items that had none, so a
-- tenant only sees the modules they actually bought. Until now Accounts,
-- Contacts, Quotations, Cases, Work orders, Technicians, Assets, Suppliers,
-- Analytics, Data Workbench and Administrator were shown to every tenant
-- unconditionally -- which is wrong for a client who subscribed to Workforce
-- only.
--
-- ⚠️ THE BACKFILL BELOW IS THE WHOLE POINT OF THIS MIGRATION, not a
-- convenience. The app reads a flag as `features?.[key] === true`, so a key
-- that is ABSENT reads as false = hidden. Adding these gates without first
-- writing them as true would instantly strip navigation from every existing
-- tenant, including live clients. Every pre-existing tenant therefore keeps
-- exactly what they see today; only a tenant explicitly switched off
-- afterwards (Admin -> Tenants -> Features) loses anything.
--
-- `||` merges right-hand keys over the existing object, so any flag a tenant
-- has already had set is preserved rather than reset -- and re-running this
-- migration is harmless for the same reason.

update tenants
set features = features || jsonb_build_object(
  'accounts',       coalesce(features->'accounts', 'true'::jsonb),
  'contacts',       coalesce(features->'contacts', 'true'::jsonb),
  'quotations',     coalesce(features->'quotations', 'true'::jsonb),
  'cases',          coalesce(features->'cases', 'true'::jsonb),
  'work_orders',    coalesce(features->'work_orders', 'true'::jsonb),
  'technicians',    coalesce(features->'technicians', 'true'::jsonb),
  'assets',         coalesce(features->'assets', 'true'::jsonb),
  'suppliers',      coalesce(features->'suppliers', 'true'::jsonb),
  'reports',        coalesce(features->'reports', 'true'::jsonb),
  'data_workbench', coalesce(features->'data_workbench', 'true'::jsonb),
  'administration', coalesce(features->'administration', 'true'::jsonb)
);
