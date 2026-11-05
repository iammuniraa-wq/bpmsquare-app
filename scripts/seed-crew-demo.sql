-- AI automation: demo switch, three sample tenders and a few findings for the is_demo workspace(s), so the gallery is alive.
-- Run AFTER supabase/migrations/0245_crew_foundation.sql (scripts/run-bundle-crew-0245-0246-2026-11-04.sql) and AFTER 0220, 0221, 0223 and 0225
-- (the GCC tender edition). Idempotent. Touches ONLY tenants where is_demo = true; never a client.
--
-- It switches on the flags crew, crew_tender_watch, crew_attendance (and the module flags they need: gcc_tender, pipeline, deal_room, wfm) and
-- sets the workspace time zone to Asia/Riyadh when none is set. Then, per demo workspace:
--   * Tender Watch is enabled (07:30, balanced, findings visible to deal teams); Attendance Anomalies is enabled too (02:00, balanced, findings visible to
--     workspace admins only, the shadow setting), only on a demo workspace and only while nobody has saved its settings (updated_by is null);
--   * three tender deals (TND-DEMO-01..03): one at risk (36 of 60 BOQ lines unpriced, 4 days left), one with a bid decision waiting 5 days (9 days left),
--     one healthy (40 of 40 priced, 12 days left);
--   * one finished daily run with two findings, one drafted note waiting for a person to edit and send, and a little token use for the meter.
-- The sample findings are rows, not live model output: the first real run (Run now, or the 07:30 pass) judges these same tenders itself.
--   * a fortnight of INVENTED attendance for one demo site (the second block at the end): eight demo employees, a day shift, late check-ins by five of them
--     on five days and six missing check-outs on one day, so the first real Attendance run (Run now, or the 02:00 pass) has something to judge, plus one
--     finished run with a site-level finding so the card and its strip are alive before any model has run. If the WFM tables are not there that block says
--     so and is skipped. This script is the only place attendance is ever switched on by a script, and only where is_demo = true: never a client workspace.
-- Nothing is sent anywhere: a demo workspace is redirect-only, and the drafted note stays pending until a person presses Edit and send.
-- Re-running changes nothing (deals are found by ref, findings and the note by fingerprint, demo people by employee code, punches by a fixed id).

do $$
declare
  t record;
  acc uuid; owner uuid;
  d1 uuid; d2 uuid; d3 uuid;
  src uuid; run uuid; f1 uuid;
  today date := current_date;
begin
  for t in select id from tenants where is_demo = true loop
    acc := null; owner := null; d1 := null; d2 := null; d3 := null; src := null; run := null; f1 := null;

    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"crew": true, "crew_tender_watch": true, "crew_attendance": true, "gcc_tender": true, "pipeline": true, "deal_room": true, "wfm": true}'::jsonb,
           config = case when (config #>> '{wfm,timezone}') is null
                         then jsonb_set(coalesce(config, '{}'::jsonb), '{wfm}', coalesce(config -> 'wfm', '{}'::jsonb) || '{"timezone": "Asia/Riyadh"}'::jsonb)
                         else config end
     where id = t.id;

    insert into crew_agent_settings (tenant_id, agent_key, enabled, paused, config) values
      (t.id, 'tender_watch', true,  false, '{"visibility": "deal_teams", "sensitivity": "balanced", "schedule": {"time": "07:30"}}'::jsonb),
      (t.id, 'attendance',   true,  false, '{"visibility": "admins", "sensitivity": "balanced", "schedule": {"time": "02:00"}}'::jsonb),
      (t.id, '_workspace',   false, false, '{}'::jsonb)
    on conflict (tenant_id, agent_key) do nothing;
    -- An earlier run of this seed left Attendance off: switch it on only while no person has ever saved its settings.
    update crew_agent_settings
       set enabled = true, config = '{"visibility": "admins", "sensitivity": "balanced", "schedule": {"time": "02:00"}}'::jsonb
     where tenant_id = t.id and agent_key = 'attendance' and enabled = false and updated_by is null;

    select id into acc from accounts where tenant_id = t.id order by created_at limit 1;
    select user_id into owner from tenant_users where tenant_id = t.id and role = 'admin' limit 1;
    if acc is null then
      raise notice 'demo tenant % has no account: the sample tenders were skipped', t.id;
      continue;
    end if;

    -- 1. At risk: 60 lines, 24 priced.
    select id into d1 from opportunities where tenant_id = t.id and ref = 'TND-DEMO-01';
    if d1 is null then
      insert into opportunities (tenant_id, ref, account_id, source, title, stage, outcome, expected_close, owner_id, team)
      values (t.id, 'TND-DEMO-01', acc, 'direct', 'Precast boundary wall, Dammam substation', 'estimating', 'open', today + 4, owner, '[]'::jsonb) returning id into d1;
      insert into opportunity_tenders (opportunity_id, tenant_id, tender_no, issuer_name, portal, closing_at, addenda_count)
      values (d1, t.id, 'T-DEMO-4471', 'Saudi Electricity', 'excel', (today + 4)::timestamptz + interval '9 hours', 0) on conflict do nothing;
      insert into tender_boq_sources (tenant_id, opportunity_id, version, is_current, file_name, storage_path, sheet_name, header_row, line_count)
      values (t.id, d1, 1, true, 'demo-boq.xlsx', 'demo/none', 'BOQ', 1, 60) returning id into src;
      insert into tender_boq_lines (tenant_id, opportunity_id, source_id, item_key, item_no, cost_code, row_no, file_description, file_uom, file_qty, price_source, price_as_of)
      select t.id, d1, src, 'demo-' || g, g::text, case when g % 3 = 0 then 'REINFORCEMENT' else 'CONCRETE' end, g, 'Demo BOQ line ' || g, 'm3', 10 + g,
             case when g <= 24 then 'manual' else null end, case when g <= 24 then today else null end
        from generate_series(1, 60) g
      on conflict do nothing;
    end if;

    -- 2. A bid decision waiting five days.
    select id into d2 from opportunities where tenant_id = t.id and ref = 'TND-DEMO-02';
    if d2 is null then
      insert into opportunities (tenant_id, ref, account_id, source, title, stage, outcome, expected_close, owner_id, team)
      values (t.id, 'TND-DEMO-02', acc, 'direct', 'Water network pipes, Jubail', 'bid_no_bid', 'open', today + 9, owner, '[]'::jsonb) returning id into d2;
      insert into opportunity_tenders (opportunity_id, tenant_id, tender_no, issuer_name, portal, closing_at, addenda_count)
      values (d2, t.id, 'T-DEMO-0118', 'Royal Commission', 'ariba', (today + 9)::timestamptz + interval '9 hours', 0) on conflict do nothing;
      if owner is not null then
        insert into approval_requests (tenant_id, object_type, object_id, kind, proposed_value, reason, requested_by, status, created_at)
        values (t.id, 'opportunity_tenders', d2, 'tender_bid_decision', 'go', 'Scope matches our pipe range', owner, 'pending', now() - interval '5 days') on conflict do nothing;
      end if;
    end if;

    -- 3. Healthy: 40 of 40 priced.
    select id into d3 from opportunities where tenant_id = t.id and ref = 'TND-DEMO-03';
    if d3 is null then
      insert into opportunities (tenant_id, ref, account_id, source, title, stage, outcome, expected_close, owner_id, team)
      values (t.id, 'TND-DEMO-03', acc, 'direct', 'Storm drain culverts, Riyadh', 'estimating', 'open', today + 12, owner, '[]'::jsonb) returning id into d3;
      insert into opportunity_tenders (opportunity_id, tenant_id, tender_no, issuer_name, portal, closing_at, addenda_count)
      values (d3, t.id, 'T-DEMO-2204', 'Municipality', 'email', (today + 12)::timestamptz + interval '9 hours', 0) on conflict do nothing;
      insert into tender_boq_sources (tenant_id, opportunity_id, version, is_current, file_name, storage_path, sheet_name, header_row, line_count)
      values (t.id, d3, 1, true, 'demo-boq-3.xlsx', 'demo/none', 'BOQ', 1, 40) returning id into src;
      insert into tender_boq_lines (tenant_id, opportunity_id, source_id, item_key, item_no, cost_code, row_no, file_description, file_uom, file_qty, price_source, price_as_of)
      select t.id, d3, src, 'demo-' || g, g::text, 'CONCRETE', g, 'Demo BOQ line ' || g, 'm', 5 + g, 'manual', today from generate_series(1, 40) g
      on conflict do nothing;
    end if;

    -- A finished daily run with two findings and one drafted note (only once).
    if owner is not null and not exists (select 1 from crew_runs where tenant_id = t.id and dedupe_key = 'tender_watch|daily|seed') then
      insert into crew_runs (tenant_id, agent_key, trigger, trigger_ref, scope, candidates, dedupe_key, status, attempt, model, prompt_version, input_tokens, output_tokens, turns,
                             tool_calls, findings_count, proposals_count, started_at, finished_at, purge_after)
      values (t.id, 'tender_watch', 'schedule', 'Daily pass', jsonb_build_object('deal_ids', jsonb_build_array(d1, d2)), jsonb_build_array(d1, d2), 'tender_watch|daily|seed', 'done', 1,
              'seed', 'tw-1', 14200, 1850, 3, 2, 2, 1, now() - interval '2 hours', now() - interval '2 hours', today + 180)
      returning id into run;

      insert into crew_findings (tenant_id, run_id, agent_key, kind, severity, subject_type, subject_id, title, body, evidence, gaps, fingerprint, recipient_ids, status, purge_after)
      values (t.id, run, 'tender_watch', 'at_risk', 'urgent', 'opportunity', d1::text,
              'Pricing is unlikely to finish before the bid end date: 36 of 60 lines are still unpriced.',
              'TND-DEMO-01 ends in 4 days. No supplier reply is recorded for the open lines, and the room has been quiet for 3 days.',
              jsonb_build_array(jsonb_build_object('step', 's1', 'path', 'deals.d1.boq.unpriced', 'label', 'Unpriced lines', 'href', '/pipeline/' || d1::text),
                                jsonb_build_object('step', 's1', 'path', 'deals.d1.days_to_close', 'label', 'Days left', 'href', '/pipeline/' || d1::text)),
              '[]'::jsonb, 'seed-' || t.id::text || '-d1-at-risk', array[owner], 'open', today + 180)
      on conflict do nothing
      returning id into f1;

      insert into crew_findings (tenant_id, run_id, agent_key, kind, severity, subject_type, subject_id, title, body, evidence, gaps, fingerprint, recipient_ids, status, purge_after)
      values (t.id, run, 'tender_watch', 'stuck_decision', 'review', 'opportunity', d2::text,
              'The bid decision has waited 5 days and 9 days remain.',
              'TND-DEMO-02 is still in the bid decision stage and no BOQ has been uploaded.',
              jsonb_build_array(jsonb_build_object('step', 's1', 'path', 'deals.d2.approval.age_days', 'label', 'Waiting days', 'href', '/pipeline/' || d2::text)),
              '[]'::jsonb, 'seed-' || t.id::text || '-d2-stuck', array[owner], 'open', today + 180)
      on conflict do nothing;

      if f1 is not null then
        insert into crew_proposals (tenant_id, finding_id, run_id, agent_key, action_key, target_type, target_id, payload, status, approver_ids, fingerprint, expires_at)
        values (t.id, f1, run, 'tender_watch', 'tender.nudge', 'opportunity', d1::text,
                jsonb_build_object('recipient_ids', jsonb_build_array(owner), 'label', 'TND-DEMO-01', 'finding_title', 'Pricing is unlikely to finish before the bid end date',
                                   'message', 'TND-DEMO-01 closes in a few days and 36 BOQ lines are still unpriced. Could you chase the suppliers who have not replied, or tell the team which lines to price from past projects?'),
                'pending', array[owner], 'seed-' || t.id::text || '-d1-nudge', now() + interval '3 days')
        on conflict do nothing;
      end if;

      begin
        insert into ai_usage_log (tenant_id, user_id, surface, study_id, model, input_tokens, output_tokens)
        values (t.id, null, 'crew:tender_watch', run, 'seed', 14200, 1850);
      exception when undefined_table then
        null;
      end;
    end if;
  end loop;
end $$;

-- ── Attendance Anomalies: a fortnight of invented attendance for one demo site, and one finished run ─────────────────────────────────────────────────
-- Separate block so that a workspace without the WFM tables, or with a different shape, skips only this part. Demo workspaces only.
do $$
declare
  t record;
  tz text; woff int[]; site uuid; shift uuid; emp uuid; run uuid; snap jsonb; fp text;
  i int; k int; d date; late boolean; no_out boolean; first_in timestamptz;
  today date := current_date;
begin
  for t in select id, config from tenants where is_demo = true and coalesce((features ->> 'wfm')::boolean, false) loop
    begin
      tz := coalesce(t.config #>> '{wfm,timezone}', 'Asia/Riyadh');
      woff := array(select jsonb_array_elements_text(t.config #> '{wfm,week_off_days}')::int);
      if coalesce(array_length(woff, 1), 0) = 0 then woff := array[0]; end if;

      select id into site from wfm_sites where tenant_id = t.id and name = 'Crew demo site';
      if site is null then
        insert into wfm_sites (tenant_id, name, lat, lng, radius_m, active) values (t.id, 'Crew demo site', 26.4207, 50.0888, 150, true) returning id into site;
      end if;
      select id into shift from wfm_shifts where tenant_id = t.id and name = 'Crew demo day shift';
      if shift is null then
        insert into wfm_shifts (tenant_id, name, start_time, end_time, grace_minutes) values (t.id, 'Crew demo day shift', '08:00', '17:00', 10) returning id into shift;
      end if;

      for i in 1..8 loop
        select id into emp from employees where tenant_id = t.id and employee_code = 'CREWDEMO-0' || i;
        if emp is null then
          insert into employees (tenant_id, first_name, last_name, employee_code, status, shift_id, site_id, employment_type)
          values (t.id, 'Demo', 'Employee ' || i, 'CREWDEMO-0' || i, 'active', shift, site, 'full_time') returning id into emp;
        end if;
        for k in 1..14 loop
          d := today - k;
          continue when extract(dow from d)::int = any(woff);
          late := i <= 5 and k in (2, 3, 4, 6, 7);
          no_out := i <= 6 and k = 5;
          first_in := ((d::text || ' 08:00')::timestamp + case when late then interval '25 minutes' else interval '0 minutes' end) at time zone tz;
          insert into wfm_presence_events (id, tenant_id, employee_id, ts, kind, source, site_id, geo_lat, geo_lng, within_geofence, flags)
          values (md5(t.id::text || emp::text || d::text || 'in')::uuid, t.id, emp, first_in, 'check_in', 'manual_admin', site, 26.4207, 50.0888, true, '{}'::jsonb)
          on conflict (id) do nothing;
          if not no_out then
            insert into wfm_presence_events (id, tenant_id, employee_id, ts, kind, source, site_id, geo_lat, geo_lng, within_geofence, flags)
            values (md5(t.id::text || emp::text || d::text || 'out')::uuid, t.id, emp, ((d::text || ' 17:05')::timestamp) at time zone tz, 'check_out', 'manual_admin', site, 26.4207, 50.0888, true, '{}'::jsonb)
            on conflict (id) do nothing;
          end if;
        end loop;
      end loop;

      -- One finished run with a site-level finding, so the Review card and its strip of dots are alive before any model has run.
      fp := 'seed-' || t.id::text || '-att-late';
      if not exists (select 1 from crew_runs where tenant_id = t.id and dedupe_key = 'attendance|site:' || site::text || '|day:seed') then
        snap := jsonb_build_object(
          'site', 'S1',
          'strip', jsonb_build_object(
            'dates', (select jsonb_agg((today - g)::text order by g desc) from generate_series(1, 14) g),
            'rostered', (select jsonb_agg(case when extract(dow from today - g)::int = any(woff) then 0 else 8 end order by g desc) from generate_series(1, 14) g),
            'present', (select jsonb_agg(case when extract(dow from today - g)::int = any(woff) then 0 else 8 end order by g desc) from generate_series(1, 14) g),
            'flagged', (select jsonb_agg(case when g in (2, 3, 4, 6, 7) then 5 when g = 5 then 6 else 0 end order by g desc) from generate_series(1, 14) g)),
          'marked', jsonb_build_object(fp, (select jsonb_agg((today - g)::text order by g desc) from unnest(array[2, 3, 4, 6, 7]) g)));
        insert into crew_runs (tenant_id, agent_key, trigger, trigger_ref, scope, candidates, dedupe_key, status, attempt, model, prompt_version, input_tokens, output_tokens, turns,
                               tool_calls, findings_count, proposals_count, snapshot, alias_map, started_at, finished_at, purge_after)
        values (t.id, 'attendance', 'schedule', 'Daily pass', jsonb_build_object('site_id', site, 'from', (today - 14)::text, 'to', (today - 1)::text), jsonb_build_array(site::text),
                'attendance|site:' || site::text || '|day:seed', 'done', 1, 'seed', 'attendance@seed', 6400, 900, 2, 1, 1, 0, snap,
                jsonb_build_object('persons', '{}'::jsonb, 'sites', jsonb_build_object('S1', site::text)), now() - interval '3 hours', now() - interval '3 hours', today + 90)
        returning id into run;
        insert into crew_findings (tenant_id, run_id, agent_key, kind, severity, subject_type, subject_id, site_id, title, body, evidence, gaps, fingerprint, recipient_ids, status, purge_after)
        values (t.id, run, 'attendance', 'late_cluster', 'review', 'site', site::text, site,
                'Late check-ins cluster on five days at S1',
                'What was observed: Five of the eight people checked in late on five of the last fourteen shift-days.' || chr(10) ||
                'What else could explain it: The shift start or grace setting may not match the real start, or a gate or transport routine changed.' || chr(10) ||
                'What you could do: Review the shift start in Settings, or do nothing and look again next week.',
                jsonb_build_array(jsonb_build_object('step', 's1', 'path', 'candidates[0].people_affected', 'label', 'People late', 'href', null),
                                  jsonb_build_object('step', 's1', 'path', 'candidates[0].days', 'label', 'Days', 'href', null)),
                '[]'::jsonb, fp, '{}', 'open', today + 90)
        on conflict do nothing;
        begin
          insert into ai_usage_log (tenant_id, user_id, surface, study_id, model, input_tokens, output_tokens) values (t.id, null, 'crew:attendance', run, 'seed', 6400, 900);
        exception when undefined_table then
          null;
        end;
      end if;
    exception when undefined_table or undefined_column or check_violation or not_null_violation then
      raise notice 'demo workspace %: the Attendance sample data was skipped (%)', t.id, sqlerrm;
    end;
  end loop;
end $$;
