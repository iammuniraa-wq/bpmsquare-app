-- Lead scoring ("Leads that score themselves"): demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0140, 0160, 0161 and 0137 (the event stream).
-- Idempotent: a lead whose title already exists in a demo workspace is left alone and
-- every event carries a fixed natural key, so running it twice adds nothing. Touches ONLY
-- tenants where is_demo = true; never a client.
--
-- It does four things per demo tenant:
--   1. switches the lead-scoring program on (marketing_scoring, which needs marketing and leads);
--   2. makes sure the workspace has its eight lead stages (the app would create them the first
--      time a stage is changed; doing it here lets the seeded leads sit in a stage straight away);
--   3. adds six sample leads on the workspace's first accounts, telling a story you can walk through:
--        - a lead that just became Ready for sales and is due in a few hours,
--        - a lead that has been Ready for two days and is overdue,
--        - an Engaged lead that clicked the newsletter twice,
--        - a brand-new lead from a website visit,
--        - a lead a salesperson is Working,
--        - a lead that unsubscribed after an offer (shows a negative reason first).
--      Each has the events behind its score in the event stream, so "Score again" and the
--      nightly run reproduce the numbers from what the person did (within a few points: the
--      stored score is the one the engine would have given at seeding time);
--   4. sets the oldest Coverage team of the workspace to share new sales-ready leads in turn
--      (round robin), when the workspace has teams.
-- Owners are the workspace's own first two members. Nothing here sends an email.

create or replace function pg_temp.ls_stage(p_tenant uuid, p_code text)
returns uuid language sql stable as $$
  select cs.id from custom_status cs
   where cs.tenant_id = p_tenant and cs.entity_type = 'leads' and cs.code = p_code limit 1
$$;

create or replace function pg_temp.ls_ensure_stages(p_tenant uuid)
returns void language plpgsql as $fn$
declare
  v_profile uuid;
  s record;
begin
  select id into v_profile from status_profile where tenant_id = p_tenant and entity_type = 'leads' and is_default = true limit 1;
  if v_profile is null then
    insert into status_profile (tenant_id, entity_type, name, is_default)
    values (p_tenant, 'leads', 'Lead stages', true) returning id into v_profile;
  end if;
  for s in
    select * from (values
      (0, 'new', 'NEW', 'New'), (1, 'engaged', 'ENGAGED', 'Engaged'), (2, 'ready', 'READY', 'Ready for sales'),
      (3, 'working', 'WORKING', 'Working'), (4, 'deal', 'DEAL', 'Deal'), (5, 'customer', 'CUSTOMER', 'Customer'),
      (6, 'not_now', 'NOT_NOW', 'Not now'), (7, 'not_fit', 'NOT_FIT', 'Not a fit')
    ) as v(ord, code, sys, label)
  loop
    if not exists (select 1 from custom_status where tenant_id = p_tenant and status_profile_id = v_profile and code = s.code) then
      insert into custom_status (tenant_id, status_profile_id, entity_type, system_status_code, code, label, is_initial, sort_order)
      values (p_tenant, v_profile, 'leads', s.sys, s.code, s.label, s.code = 'new', s.ord);
    end if;
  end loop;
  -- Any stage may move to any other, as the app creates it.
  insert into status_transition_rule (tenant_id, status_profile_id, from_custom_status_id, to_custom_status_id)
  select p_tenant, v_profile, null, cs.id
    from custom_status cs
   where cs.tenant_id = p_tenant and cs.status_profile_id = v_profile
     and not exists (
       select 1 from status_transition_rule r
        where r.tenant_id = p_tenant and r.status_profile_id = v_profile and r.to_custom_status_id = cs.id and r.from_custom_status_id is null);
end
$fn$;

-- p: {title, source, stage, status, score, label, band, owner (0|1), sla_hours (null | hours from now, negative = past),
--     ready_hours_ago, reason, factors: [...], events: [{name, hours_ago, payload}]}
create or replace function pg_temp.ls_lead(p_tenant uuid, p_account uuid, p_contact uuid, p_owners uuid[], p jsonb)
returns void language plpgsql as $fn$
declare
  v_id uuid;
  e jsonb;
  i int := 0;
  v_owner uuid;
begin
  if exists (select 1 from leads where tenant_id = p_tenant and title = p->>'title') then
    return;
  end if;
  v_owner := case when (p->>'owner') is null then null else p_owners[(p->>'owner')::int + 1] end;

  insert into leads (
    tenant_id, account_id, contact_id, title, source, status, custom_status_id,
    score, score_factors, scored_at, owner_user_id, sla_due_at, last_activity_at
  ) values (
    p_tenant, p_account, p_contact, p->>'title', p->>'source', p->>'status', pg_temp.ls_stage(p_tenant, p->>'stage'),
    (p->>'score')::int,
    jsonb_build_object('rubric_version', 1, 'label', p->>'label', 'stage', p->>'band', 'factors', p->'factors', 'events_seen', jsonb_array_length(p->'events')),
    now(), v_owner,
    case when p->>'sla_hours' is null then null else now() + ((p->>'sla_hours')::numeric * interval '1 hour') end,
    now() - interval '1 hour'
  ) returning id into v_id;

  -- The columns 0160 adds. Written separately so a database without it still gets the lead.
  begin
    update leads set
      ready_at = case when p->>'ready_hours_ago' is null then null else now() - ((p->>'ready_hours_ago')::numeric * interval '1 hour') end,
      assigned_at = case when v_owner is null then null else now() - interval '2 hours' end,
      assignment_reason = case when v_owner is null then null else p->>'reason' end
     where id = v_id and tenant_id = p_tenant;
  exception when undefined_column then
    null;
  end;

  for e in select * from jsonb_array_elements(p->'events') loop
    i := i + 1;
    insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, payload, occurred_at, created_at, dedupe_key)
    values (
      p_tenant, e->>'name', coalesce(e->>'object_type', 'contact'), coalesce(p_contact, p_account), coalesce(e->>'source', 'app'),
      p_contact, p_account, coalesce(e->'payload', '{}'::jsonb),
      now() - ((e->>'hours_ago')::numeric * interval '1 hour'), now() - ((e->>'hours_ago')::numeric * interval '1 hour'),
      'seed-leads-demo:' || v_id::text || ':' || i::text
    ) on conflict (tenant_id, dedupe_key) do nothing;
  end loop;
end
$fn$;

do $seed$
declare
  t record;
  v_owners uuid[];
  v_acc uuid[];
  v_con uuid[];
  k int;
  v_team uuid;
begin
  for t in select id from tenants where is_demo = true loop
    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "leads": true, "marketing_scoring": true}'::jsonb
     where id = t.id;

    perform pg_temp.ls_ensure_stages(t.id);

    select coalesce(array_agg(user_id order by created_at), '{}') into v_owners
      from (select user_id, created_at from tenant_users where tenant_id = t.id order by created_at limit 2) u;
    -- A workspace with a single member gives that one person every lead.
    if coalesce(array_length(v_owners, 1), 0) = 1 then v_owners := array[v_owners[1], v_owners[1]]; end if;

    select array_agg(id order by created_at) into v_acc
      from (select id, created_at from accounts where tenant_id = t.id order by created_at limit 6) a;
    if v_acc is null or array_length(v_acc, 1) < 1 then continue; end if;

    v_con := '{}';
    for k in 1 .. array_length(v_acc, 1) loop
      v_con := array_append(v_con, (select c.id from contacts c where c.tenant_id = t.id and c.account_id = v_acc[k] order by c.created_at limit 1));
    end loop;

    -- 1. Just became ready, due in a few hours.
    perform pg_temp.ls_lead(t.id, v_acc[1], v_con[1], v_owners, jsonb_build_object(
      'title', 'Spare parts enquiry (sample)', 'source', 'campaign', 'stage', 'ready', 'status', 'new',
      'score', 84, 'label', 'Ready for sales', 'band', 'ready', 'owner', 0, 'reason', 'team_lead', 'sla_hours', 6, 'ready_hours_ago', 2,
      'factors', jsonb_build_array(
        jsonb_build_object('kind','behaviour','label','Said they are interested','points',29,'detail','1 time in the last 90 days, most recently yesterday (fades over 30 days)'),
        jsonb_build_object('kind','behaviour','label','Opened a quote','points',27,'detail','2 times in the last 90 days, most recently today (fades over 14 days)'),
        jsonb_build_object('kind','behaviour','label','Clicked a link in an email','points',18,'detail','2 times in the last 90 days, most recently yesterday (fades over 14 days)'),
        jsonb_build_object('kind','profile','label','Buyer-type role','points',10,'detail','Matches this profile')),
      'events', jsonb_build_array(
        jsonb_build_object('name','email.clicked','hours_ago',50,'source','public_link'),
        jsonb_build_object('name','email.clicked','hours_ago',27,'source','public_link'),
        jsonb_build_object('name','email.interest','hours_ago',26,'source','public_link'),
        jsonb_build_object('name','quote.opened','hours_ago',20,'source','public_link'),
        jsonb_build_object('name','quote.opened','hours_ago',3,'source','public_link'))));

    -- 2. Ready for two days and nobody picked it up: overdue.
    if array_length(v_acc, 1) >= 2 then
      perform pg_temp.ls_lead(t.id, v_acc[2], v_con[2], v_owners, jsonb_build_object(
        'title', 'Annual service renewal (sample)', 'source', 'amc', 'stage', 'ready', 'status', 'new',
        'score', 71, 'label', 'Ready for sales', 'band', 'ready', 'owner', 1, 'reason', 'round_robin', 'sla_hours', -20, 'ready_hours_ago', 44,
        'factors', jsonb_build_array(
          jsonb_build_object('kind','behaviour','label','Filled in a form','points',27,'detail','1 time in the last 90 days, most recently 3 days ago (fades over 30 days)'),
          jsonb_build_object('kind','behaviour','label','Opened a quote','points',19,'detail','1 time in the last 90 days, most recently 3 days ago (fades over 14 days)'),
          jsonb_build_object('kind','profile','label','Has an active service contract','points',5,'detail','Matches this profile'),
          jsonb_build_object('kind','profile','label','Based in the Gulf','points',5,'detail','Matches this profile'),
          jsonb_build_object('kind','profile','label','Buyer-type role','points',10,'detail','Matches this profile'),
          jsonb_build_object('kind','behaviour','label','Clicked a link in an email','points',5,'detail','1 time in the last 90 days, most recently 6 days ago (fades over 14 days)')),
        'events', jsonb_build_array(
          jsonb_build_object('name','email.clicked','hours_ago',140,'source','public_link'),
          jsonb_build_object('name','form.submitted','hours_ago',76,'source','public_link'),
          jsonb_build_object('name','quote.opened','hours_ago',75,'source','public_link'))));
    end if;

    -- 3. Engaged: clicked the newsletter twice.
    if array_length(v_acc, 1) >= 3 then
      perform pg_temp.ls_lead(t.id, v_acc[3], v_con[3], v_owners, jsonb_build_object(
        'title', 'Newsletter reader (sample)', 'source', 'campaign', 'stage', 'engaged', 'status', 'new',
        'score', 38, 'label', 'Engaged', 'band', 'engaged',
        'factors', jsonb_build_array(
          jsonb_build_object('kind','behaviour','label','Clicked a link in an email','points',18,'detail','2 times in the last 90 days, most recently yesterday (fades over 14 days)'),
          jsonb_build_object('kind','profile','label','OEM account','points',10,'detail','Matches this profile'),
          jsonb_build_object('kind','profile','label','Based in the Gulf','points',5,'detail','Matches this profile'),
          jsonb_build_object('kind','behaviour','label','Visited the website','points',5,'detail','3 times in the last 90 days, most recently 2 days ago (fades over 7 days)')),
        'events', jsonb_build_array(
          jsonb_build_object('name','email.clicked','hours_ago',60,'source','public_link'),
          jsonb_build_object('name','email.clicked','hours_ago',28,'source','public_link'),
          jsonb_build_object('name','web.page_viewed','hours_ago',70,'source','tracker','payload',jsonb_build_object('buying_interest', false)),
          jsonb_build_object('name','web.page_viewed','hours_ago',55,'source','tracker','payload',jsonb_build_object('buying_interest', false)),
          jsonb_build_object('name','web.page_viewed','hours_ago',50,'source','tracker','payload',jsonb_build_object('buying_interest', false)))));
    end if;

    -- 4. Brand new: one website visit.
    if array_length(v_acc, 1) >= 4 then
      perform pg_temp.ls_lead(t.id, v_acc[4], v_con[4], v_owners, jsonb_build_object(
        'title', 'Website visitor (sample)', 'source', 'direct', 'stage', 'new', 'status', 'new',
        'score', 8, 'label', 'New', 'band', 'new',
        'factors', jsonb_build_array(
          jsonb_build_object('kind','behaviour','label','Visited the website','points',2,'detail','1 time in the last 90 days, most recently today (fades over 7 days)'),
          jsonb_build_object('kind','profile','label','Based in the Gulf','points',5,'detail','Matches this profile')),
        'events', jsonb_build_array(
          jsonb_build_object('name','web.page_viewed','hours_ago',4,'source','tracker','payload',jsonb_build_object('buying_interest', false)))));
    end if;

    -- 5. A salesperson is working it.
    if array_length(v_acc, 1) >= 5 then
      perform pg_temp.ls_lead(t.id, v_acc[5], v_con[5], v_owners, jsonb_build_object(
        'title', 'Pump replacement project (sample)', 'source', 'oem_referral', 'stage', 'working', 'status', 'inspecting',
        'score', 66, 'label', 'Ready for sales', 'band', 'ready', 'owner', 0, 'reason', 'claimed', 'sla_hours', -70, 'ready_hours_ago', 96,
        'factors', jsonb_build_array(
          jsonb_build_object('kind','behaviour','label','Said they are interested','points',24,'detail','1 time in the last 90 days, most recently 4 days ago (fades over 30 days)'),
          jsonb_build_object('kind','behaviour','label','Opened a quote','points',12,'detail','1 time in the last 90 days, most recently 5 days ago (fades over 14 days)'),
          jsonb_build_object('kind','profile','label','OEM account','points',10,'detail','Matches this profile'),
          jsonb_build_object('kind','profile','label','Buyer-type role','points',10,'detail','Matches this profile'),
          jsonb_build_object('kind','behaviour','label','Clicked a link in an email','points',10,'detail','2 times in the last 90 days, most recently 6 days ago (fades over 14 days)')),
        'events', jsonb_build_array(
          jsonb_build_object('name','email.clicked','hours_ago',150,'source','public_link'),
          jsonb_build_object('name','email.clicked','hours_ago',146,'source','public_link'),
          jsonb_build_object('name','quote.opened','hours_ago',120,'source','public_link'),
          jsonb_build_object('name','email.interest','hours_ago',96,'source','public_link'))));
    end if;

    -- 6. Unsubscribed after an offer: the negative reason is listed first.
    if array_length(v_acc, 1) >= 6 then
      perform pg_temp.ls_lead(t.id, v_acc[6], v_con[6], v_owners, jsonb_build_object(
        'title', 'Offer follow-up (sample)', 'source', 'campaign', 'stage', 'new', 'status', 'new',
        'score', 0, 'label', 'New', 'band', 'new',
        'factors', jsonb_build_array(
          jsonb_build_object('kind','behaviour','label','Unsubscribed','points',-40,'detail','1 time in the last 90 days, most recently yesterday'),
          jsonb_build_object('kind','behaviour','label','Clicked a link in an email','points',9,'detail','1 time in the last 90 days, most recently 3 days ago (fades over 14 days)'),
          jsonb_build_object('kind','profile','label','Based in the Gulf','points',5,'detail','Matches this profile')),
        'events', jsonb_build_array(
          jsonb_build_object('name','email.clicked','hours_ago',72,'source','public_link'),
          jsonb_build_object('name','email.unsubscribed','hours_ago',20,'source','public_link'))));
    end if;

    -- Round robin on the workspace's oldest team, if it has one and 0161 is applied.
    begin
      select id into v_team from teams where tenant_id = t.id order by created_at limit 1;
      if v_team is not null then
        update teams set assignment_mode = 'round_robin' where id = v_team and tenant_id = t.id;
      end if;
    exception when undefined_column then
      null;
    end;
  end loop;
end
$seed$;
