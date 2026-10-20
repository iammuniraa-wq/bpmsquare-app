-- Journeys: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0165_journeys.sql (and 0166-0169 for the full picture; the
-- sample newsletter version needs scripts/seed-newsletter-studio-demo.sql and a version kept
-- from "Use in a campaign"). Idempotent: a journey that already exists (by name) in a demo
-- workspace is left alone, so it is safe to run twice. Touches ONLY tenants where is_demo = true;
-- never a client.
--
-- Per demo tenant it:
--   1. switches the journeys flag on (and marketing, which it needs);
--   2. adds ONE journey, "Quote follow-up (sample)", as a DRAFT: when a Standard Quote is sent,
--      wait 3 days, send a newsletter version, create a task for the owner. If the workspace has a
--      kept newsletter version, the newest one is chosen for the send step; otherwise the step is
--      left for the person to choose (the builder says so, and Turn on stays blocked until then).
-- It does NOT turn the journey on and writes no runs, so nothing is sent and nothing in the run log is
-- invented: turning it on from the screen is the demo. On a demo workspace every email is redirected
-- to the workspace's one internal inbox in any case.
--
-- The definition is the closed JSON shape src/lib/marketing/journeys/definition.ts validates.

do $seed$
declare
  t         record;
  v_user    uuid;
  v_version uuid;
  v_seq     int;
  v_def     jsonb;
begin
  for t in select id from tenants where is_demo = true loop
    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "journeys": true}'::jsonb
     where id = t.id;

    if exists (select 1 from journeys where tenant_id = t.id and name = 'Quote follow-up (sample)') then
      continue;
    end if;

    select user_id into v_user from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;

    -- The newest kept newsletter version, if the Newsletter Studio has produced one.
    v_version := null;
    if to_regclass('public.newsletter_versions') is not null then
      select id into v_version from newsletter_versions where tenant_id = t.id order by created_at desc limit 1;
    end if;

    v_def := jsonb_build_object(
      'version', 1,
      'trigger', jsonb_build_object('event', 'quote.sent', 'condition', jsonb_build_object('field', 'object_type', 'op', 'eq', 'value', 'standard_quote')),
      'entry', jsonb_build_object('one_per_account', true, 'pause_when_in_trouble', true, 'lookback_days', 3),
      'steps', jsonb_build_array(
        jsonb_build_object('id', 's1', 'kind', 'wait', 'amount', 3, 'unit', 'days'),
        jsonb_build_object('id', 's2', 'kind', 'send_newsletter', 'newsletter_version_id', v_version, 'topic', 'offers', 'languages', '[]'::jsonb, 'fallback_language', 'en'),
        jsonb_build_object('id', 's3', 'kind', 'create_task', 'title', 'Call {contact_name} about quote {quote_ref}', 'due_in_days', 1)
      )
    );

    select coalesce(max((regexp_match(ref, '^JNY-(\d+)$'))[1]::int), 0) + 1 into v_seq
      from journeys where tenant_id = t.id and ref ~ '^JNY-\d+$';

    insert into journeys (tenant_id, ref, name, status, definition, trigger_name, version, created_by)
    values (t.id, 'JNY-' || lpad(v_seq::text, 4, '0'), 'Quote follow-up (sample)', 'draft', v_def, 'quote.sent', 1, v_user);
  end loop;
end
$seed$;
