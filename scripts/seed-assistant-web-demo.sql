-- Assistant web research: demo switch for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0205_assistant_actions.sql (the flag works without it, but no audit row is written).
-- Idempotent. Touches ONLY tenants where is_demo = true that already have the AI assistant on; never a client.
--
-- It switches the ai_assistant_web flag on. Nothing else is seeded: a web search leaves its own audit row.

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"ai_assistant_web": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'ai_assistant')::boolean, false) = true
   and coalesce((features ->> 'ai_assistant_web')::boolean, false) = false;
