-- Marketing events: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0195_marketing_events.sql and 0196_event_registrations.sql (the forms migrations
-- 0170-0172 for the linked form). Idempotent: if the sample events are already there the script does nothing.
-- Touches ONLY tenants where is_demo = true; never a client.
--
-- Per demo tenant it:
--   1. switches marketing_events on (and marketing and marketing_forms, which it needs; journeys is left alone);
--   2. adds two SAMPLE events: "Precast open day (sample)", an exhibition 9 days ago that has already happened,
--      with 8 registrations from the workspace's contacts (5 came, 2 did not, 1 cancelled), so the Attendees and
--      Results tabs have something real to show; and "Site visit, Riyadh (sample)", a site visit 12 days from now
--      with registration open and 3 people registered. If the workspace has a form, the upcoming event is linked to
--      the first one and the past event is not (a form can belong to one running event).
-- It writes no domain events and starts no journey: pressing Start the follow-up on the past event is the demo.
-- Registrations written here have no event-stream rows; the live flow does write them.

do $seed$
declare
  t         record;
  u         uuid;
  f_id      uuid;
  e_past    uuid;
  e_next    uuid;
  seq       int;
  r         record;
  n         int;
begin
  for t in select id from tenants where is_demo = true loop
    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "marketing_forms": true, "marketing_events": true}'::jsonb
     where id = t.id;

    if exists (select 1 from marketing_events where tenant_id = t.id and name like '%(sample)') then
      continue;
    end if;

    select user_id into u from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;
    f_id := null;
    if to_regclass('public.forms') is not null then
      select id into f_id from forms where tenant_id = t.id and status <> 'archived' order by created_at limit 1;
    end if;

    select coalesce(max((regexp_match(ref, '^EVT-(\d+)$'))[1]::int), 0) into seq from marketing_events where tenant_id = t.id and ref ~ '^EVT-\d+$';

    insert into marketing_events (tenant_id, ref, name, kind, status, starts_at, ends_at, venue, capacity, description, owner_user_id, created_by)
    values (t.id, 'EVT-' || lpad((seq + 1)::text, 4, '0'), 'Precast open day (sample)', 'exhibition', 'completed',
            date_trunc('day', now() - interval '9 days') + interval '7 hours', date_trunc('day', now() - interval '9 days') + interval '12 hours',
            'Riyadh yard', 10, 'A morning at the yard: panels, hollow-core slabs and a loading demonstration.', u, u)
    returning id into e_past;

    insert into marketing_events (tenant_id, ref, name, kind, status, starts_at, ends_at, venue, capacity, description, form_id, owner_user_id, created_by)
    values (t.id, 'EVT-' || lpad((seq + 2)::text, 4, '0'), 'Site visit, Riyadh (sample)', 'site_visit', 'open',
            date_trunc('day', now() + interval '12 days') + interval '6 hours', date_trunc('day', now() + interval '12 days') + interval '9 hours',
            'Najd Villas, phase 2', 20, 'A walk round a finished precast project with the site engineer.', f_id, u, u)
    returning id into e_next;

    -- The past event: 8 contacts, in order of creation.
    n := 0;
    for r in select ct.id, ct.account_id from contacts ct where ct.tenant_id = t.id order by ct.created_at, ct.id limit 8 loop
      n := n + 1;
      insert into event_registrations (tenant_id, event_id, contact_id, account_id, status, source, registered_at, checked_in_at, checked_in_by)
      values (t.id, e_past, r.id, r.account_id,
              case when n <= 5 then 'attended' when n <= 7 then 'no_show' else 'cancelled' end, 'form',
              now() - interval '20 days' + make_interval(hours => n),
              case when n <= 5 then date_trunc('day', now() - interval '9 days') + interval '7 hours 20 minutes' + make_interval(mins => n * 4) else null end,
              case when n <= 5 then u else null end)
      on conflict (tenant_id, event_id, contact_id) do nothing;
    end loop;

    -- The upcoming event: three contacts.
    n := 0;
    for r in select ct.id, ct.account_id from contacts ct where ct.tenant_id = t.id order by ct.created_at desc, ct.id limit 3 loop
      n := n + 1;
      insert into event_registrations (tenant_id, event_id, contact_id, account_id, status, source, registered_at)
      values (t.id, e_next, r.id, r.account_id, 'registered', case when n = 3 then 'rep' else 'form' end, now() - make_interval(days => n))
      on conflict (tenant_id, event_id, contact_id) do nothing;
    end loop;
  end loop;
end
$seed$;
