-- Integration middleware: demo switch for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0201_integration_middleware.sql.
-- Idempotent. Touches ONLY tenants where is_demo = true; never a client.
--
-- It switches the integration_middleware flag on and nothing else: the rules
-- start at their defaults (automatic on awarded, rejected closes the ERP quote;
-- fence selection = summary + quantity lines; estimate selection = summary +
-- quote lines, bom and wbs for Project targets, internal costs OFF). Nothing is
-- sent anywhere until an ERP connection is saved and a quote is awarded.

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"integration_middleware": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'integration_middleware')::boolean, false) = false;
