-- Buying signals: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0175-0178 (all four). Idempotent: a workspace that
-- already has the sample accounts below is left alone, so it is safe to run twice.
-- Touches ONLY tenants where is_demo = true; never a client.
--
-- Per demo tenant it:
--   1. switches the buying_signals feature flag on (and marketing, which it needs);
--   2. adds one topic, "Precast";
--   3. adds five clearly labelled sample accounts, each named "... (Sample)", with the
--      first-party records the score is built from: standard quotes, a contract that is
--      about to end, two sent campaigns with link clicks (one on the Precast topic) and
--      "I am interested" leads;
--   4. adds eight weeks of stored scores for them so the small score line, the
--      "moved up" highlight and "Did it work?" have something to show on the first visit.
-- It does NOT write the live score: after running it, press "Rescore now" on the page
-- (or call /api/signals/cron/rescore once) and the real recompute scores the sample
-- records, moves a couple of stages and writes today's row. Nothing here sends an email.
--
-- To remove it: delete the accounts whose name ends in "(Sample)" in this tenant
-- (their quotes, contract, recipients, clicks, leads and signal rows go with them).

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "buying_signals": true}'::jsonb
 where is_demo = true;

do $seed$
declare
  t record;
  v_topic uuid;
  v_c1 uuid;
  v_c2 uuid;
  a record;
  v_acc uuid;
  v_r1 uuid;
  v_r2 uuid;
begin
  for t in select id from tenants where is_demo = true loop
    if exists (select 1 from accounts where tenant_id = t.id and name = 'Najd Precast Co. (Sample)') then
      continue;
    end if;

    insert into signal_topics (tenant_id, name, keywords)
    values (t.id, 'Precast', array['precast', 'boundary wall'])
    on conflict do nothing;
    select id into v_topic from signal_topics where tenant_id = t.id and lower(name) = 'precast';

    insert into marketing_campaigns (tenant_id, name, subject, body, status, sent_count, created_at, sent_at)
    values (t.id, 'October precast update (Sample)', 'October precast update', '', 'sent', 5, now() - interval '7 days', now() - interval '6 days')
    returning id into v_c1;
    insert into marketing_campaigns (tenant_id, name, subject, body, status, sent_count, created_at, sent_at)
    values (t.id, 'Fire safety reminder (Sample)', 'Fire safety reminder', '', 'sent', 5, now() - interval '15 days', now() - interval '14 days')
    returning id into v_c2;

    for a in select * from (values
      ('Najd Precast Co. (Sample)',      'Riyadh',  'Precast manufacturer'),
      ('Gulf Cooling Systems (Sample)',  'Dammam',  'HVAC contractor'),
      ('Al Rawabi Fire Safety (Sample)', 'Jeddah',  'Fire protection'),
      ('Eastern Steel Works (Sample)',   'Jubail',  'Steel fabrication'),
      ('Hail Modular Homes (Sample)',    'Hail',    'Modular construction')
    ) as x(name, city, industry) loop
      insert into accounts (tenant_id, name, type, city, industry, notes)
      values (t.id, a.name, 'prospect', a.city, a.industry, 'Sample account for the Buying signals demo.')
      returning id into v_acc;

      -- Recipients of both sends (so Did it work? has names to show).
      insert into marketing_campaign_recipients (tenant_id, campaign_id, account_id, status, sent_at)
      values (t.id, v_c1, v_acc, 'sent', now() - interval '6 days') returning id into v_r1;
      insert into marketing_campaign_recipients (tenant_id, campaign_id, account_id, status, sent_at)
      values (t.id, v_c2, v_acc, 'sent', now() - interval '14 days') returning id into v_r2;

      if a.name like 'Najd%' then
        insert into standard_quotes (tenant_id, ref, account_id, status, total, created_at, sent_at)
        values (t.id, 'SIG-SQ-001', v_acc, 'sent', 0, now() - interval '5 days', now() - interval '5 days');
        insert into leads (tenant_id, account_id, title, source, status, source_campaign_id, created_at)
        values (t.id, v_acc, 'Interested: October precast update', 'direct', 'new', v_c1, now() - interval '4 days');
        insert into marketing_link_clicks (tenant_id, campaign_id, recipient_id, link_index, topic_id, clicked_at)
        values (t.id, v_c1, v_r1, 0, v_topic::text, now() - interval '3 days');
        insert into account_intent (tenant_id, account_id, score, stage, previous_stage, stage_changed_at, computed_at)
        values (t.id, v_acc, 41, 'comparing', 'looking', now() - interval '9 days', now() - interval '1 day');
        insert into account_intent_history (tenant_id, account_id, day, score, stage)
        select t.id, v_acc, (now() - (d.days || ' days')::interval)::date, d.score, d.stage
          from (values (35, 8, 'quiet'), (28, 15, 'looking'), (21, 20, 'looking'), (14, 28, 'comparing'), (7, 38, 'comparing'), (1, 41, 'comparing')) as d(days, score, stage);
      elsif a.name like 'Gulf%' then
        insert into standard_quotes (tenant_id, ref, account_id, status, total, created_at, sent_at)
        values (t.id, 'SIG-SQ-002', v_acc, 'sent', 0, now() - interval '12 days', now() - interval '12 days');
        insert into marketing_link_clicks (tenant_id, campaign_id, recipient_id, link_index, clicked_at)
        values (t.id, v_c1, v_r1, 1, now() - interval '5 days');
        insert into account_intent (tenant_id, account_id, score, stage, previous_stage, stage_changed_at, computed_at)
        values (t.id, v_acc, 30, 'comparing', 'looking', now() - interval '12 days', now() - interval '1 day');
        insert into account_intent_history (tenant_id, account_id, day, score, stage)
        select t.id, v_acc, (now() - (d.days || ' days')::interval)::date, d.score, d.stage
          from (values (35, 0, 'quiet'), (21, 12, 'looking'), (14, 24, 'looking'), (12, 30, 'comparing'), (7, 33, 'comparing'), (1, 30, 'comparing')) as d(days, score, stage);
      elsif a.name like 'Al Rawabi%' then
        insert into contracts (tenant_id, account_id, ref, status, start_date, end_date)
        values (t.id, v_acc, 'SIG-AMC-001', 'active', (now() - interval '335 days')::date, (now() + interval '30 days')::date);
        insert into marketing_link_clicks (tenant_id, campaign_id, recipient_id, link_index, topic_id, clicked_at)
        values (t.id, v_c2, v_r2, 0, v_topic::text, now() - interval '2 days');
        insert into account_intent (tenant_id, account_id, score, stage, previous_stage, stage_changed_at, computed_at)
        values (t.id, v_acc, 10, 'looking', 'quiet', now() - interval '3 days', now() - interval '1 day');
        insert into account_intent_history (tenant_id, account_id, day, score, stage)
        select t.id, v_acc, (now() - (d.days || ' days')::interval)::date, d.score, d.stage
          from (values (21, 0, 'quiet'), (14, 4, 'quiet'), (7, 7, 'quiet'), (3, 10, 'looking'), (1, 10, 'looking')) as d(days, score, stage);
      elsif a.name like 'Eastern%' then
        insert into marketing_link_clicks (tenant_id, campaign_id, recipient_id, link_index, clicked_at)
        values (t.id, v_c1, v_r1, 2, now() - interval '5 days'), (t.id, v_c2, v_r2, 2, now() - interval '9 days');
        insert into account_intent (tenant_id, account_id, score, stage, previous_stage, stage_changed_at, computed_at)
        values (t.id, v_acc, 6, 'quiet', 'looking', now() - interval '20 days', now() - interval '1 day');
        insert into account_intent_history (tenant_id, account_id, day, score, stage)
        select t.id, v_acc, (now() - (d.days || ' days')::interval)::date, d.score, d.stage
          from (values (35, 14, 'looking'), (28, 16, 'looking'), (21, 12, 'looking'), (14, 8, 'quiet'), (7, 6, 'quiet'), (1, 6, 'quiet')) as d(days, score, stage);
      else
        insert into leads (tenant_id, account_id, title, source, status, source_campaign_id, created_at)
        values (t.id, v_acc, 'Interested: Fire safety reminder', 'direct', 'new', v_c2, now() - interval '9 days');
        insert into marketing_link_clicks (tenant_id, campaign_id, recipient_id, link_index, topic_id, clicked_at)
        values (t.id, v_c1, v_r1, 0, v_topic::text, now() - interval '4 days');
        insert into marketing_link_clicks (tenant_id, campaign_id, recipient_id, link_index, clicked_at)
        values (t.id, v_c2, v_r2, 3, now() - interval '8 days');
        insert into account_intent (tenant_id, account_id, score, stage, previous_stage, stage_changed_at, computed_at)
        values (t.id, v_acc, 20, 'looking', 'quiet', now() - interval '6 days', now() - interval '1 day');
        insert into account_intent_history (tenant_id, account_id, day, score, stage)
        select t.id, v_acc, (now() - (d.days || ' days')::interval)::date, d.score, d.stage
          from (values (21, 0, 'quiet'), (14, 3, 'quiet'), (9, 15, 'looking'), (6, 20, 'looking'), (1, 20, 'looking')) as d(days, score, stage);
      end if;
    end loop;
  end loop;
end
$seed$;
