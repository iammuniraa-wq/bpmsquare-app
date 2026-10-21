-- Hand-over (docs/shells/leads-shell.md): demo settings for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0198 and scripts/seed-marketing-leads-demo.sql (which switches the
-- lead-scoring program on). Idempotent: a workspace that already has "make a lead by itself" on is left
-- alone, so running it twice changes nothing. Touches ONLY tenants where is_demo = true; never a client.
--
-- It does one thing per demo workspace: turns on
--   * "Make a lead when someone becomes Engaged" (config.marketing.lifecycle.auto_create_leads), and
--   * "Tell the owner" when a lead is overdue (config.marketing.lifecycle.overdue_notify.owner),
-- keeping every other setting in config.marketing.lifecycle (response time, days off, rota) as it was.
-- Nothing here sends an email or creates a lead; the next scoring run does that.

update tenants
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{marketing}',
         coalesce(config -> 'marketing', '{}'::jsonb)
           || jsonb_build_object(
                'lifecycle',
                coalesce(config -> 'marketing' -> 'lifecycle', '{}'::jsonb)
                  || jsonb_build_object(
                       'auto_create_leads', true,
                       'overdue_notify', jsonb_build_object('owner', true, 'team_lead', false)
                     )
              ),
         true
       )
 where is_demo = true
   and coalesce(config -> 'marketing' -> 'lifecycle' ->> 'auto_create_leads', 'false') <> 'true';
