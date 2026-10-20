-- Attribution ("Revenue by campaign"): demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0190_marketing_touches.sql, 0191 and 0192 (and 0137 for the event stream, 0120 for
-- deals). Idempotent: if the sample deals are already there the script does nothing, so it is safe to run twice.
-- Touches ONLY tenants where is_demo = true; never a client.
--
-- Per demo tenant it:
--   1. switches the marketing_attribution flag on (and marketing and pipeline, which it reads);
--   2. makes two SAMPLE campaigns (if they are not there), "Autumn offers (sample)" and "Service reminder (sample)";
--   3. for the workspace's first six accounts writes SAMPLE click events (and a form submission when the workspace
--      has a form) at different times, and five SAMPLE deals (two won, two open, one lost) created between the clicks,
--      so first touch, last touch and an even share give visibly different answers;
-- It does NOT write touches or results: the page says "Not calculated yet" until an admin presses Refresh figures
-- (or the 3-hourly cron runs), which is the demo. It writes no invoices, so Paid shows nothing. The sample deals
-- are titled "(attribution sample)" so they are easy to find and delete.

do $seed$
declare
  t         record;
  u         uuid;
  c_a       uuid;
  c_b       uuid;
  f_id      uuid;
  acc       uuid;
  con       uuid;
  seq_opp   int;
  n         int;
  r         record;
begin
  for t in select id from tenants where is_demo = true loop
    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "marketing_attribution": true, "pipeline": true}'::jsonb
     where id = t.id;

    if exists (select 1 from opportunities where tenant_id = t.id and title like '%(attribution sample)') then
      continue;
    end if;
    if (select count(*) from accounts where tenant_id = t.id) < 5 then
      raise notice 'Tenant % has fewer than five accounts - attribution sample not seeded', t.id;
      continue;
    end if;

    select user_id into u from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;

    select id into c_a from marketing_campaigns where tenant_id = t.id and name = 'Autumn offers (sample)' limit 1;
    if c_a is null then
      insert into marketing_campaigns (tenant_id, name, subject, body, status, sent_at)
      values (t.id, 'Autumn offers (sample)', 'Autumn offers', '', 'sent', now() - interval '55 days') returning id into c_a;
    end if;
    select id into c_b from marketing_campaigns where tenant_id = t.id and name = 'Service reminder (sample)' limit 1;
    if c_b is null then
      insert into marketing_campaigns (tenant_id, name, subject, body, status, sent_at)
      values (t.id, 'Service reminder (sample)', 'Service reminder', '', 'sent', now() - interval '35 days') returning id into c_b;
    end if;

    f_id := null;
    if to_regclass('public.forms') is not null then
      select id into f_id from forms where tenant_id = t.id order by created_at limit 1;
    end if;

    select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) into seq_opp from opportunities where tenant_id = t.id and ref ~ '^OPP-\d+$';

    -- i, campaign A click (days ago), campaign B click (days ago), form (days ago), deal created (days ago), outcome, amount, closed (days ago)
    n := 0;
    for r in
      select * from (values
        (1, 50, null::int, null::int, 40, 'won',  120000, 10),
        (2, 45, 30,        null::int, 25, 'won',   80000,  5),
        (3, 35, 20,        null::int, 30, 'open',  60000, null::int),
        (4, 28, null::int, null::int, 21, 'open',  45000, null::int),
        (5, null::int, 15, null::int, 12, 'lost',  30000,  3),
        (6, null::int, null::int, 22, null::int, null, null::int, null::int)
      ) as v(i, a_days, b_days, form_days, deal_days, outcome, amount, closed_days)
    loop
      n := n + 1;
      select id into acc from (select id, row_number() over (order by created_at, id) as rn from accounts where tenant_id = t.id) q where rn = r.i;
      continue when acc is null;
      select id into con from contacts where tenant_id = t.id and account_id = acc order by created_at limit 1;

      if r.a_days is not null then
        insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, campaign_id, payload, occurred_at, dedupe_key)
        values (t.id, 'email.clicked', 'marketing_campaign', c_a, 'public_link', con, acc, c_a, '{"sample": true}'::jsonb, now() - make_interval(days => r.a_days), 'attribution-demo:' || r.i || ':a')
        on conflict (tenant_id, dedupe_key) do nothing;
      end if;
      if r.b_days is not null then
        insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, campaign_id, payload, occurred_at, dedupe_key)
        values (t.id, 'email.clicked', 'marketing_campaign', c_b, 'public_link', con, acc, c_b, '{"sample": true}'::jsonb, now() - make_interval(days => r.b_days), 'attribution-demo:' || r.i || ':b')
        on conflict (tenant_id, dedupe_key) do nothing;
      end if;
      if r.form_days is not null and f_id is not null then
        insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, payload, occurred_at, dedupe_key)
        values (t.id, 'form.submitted', 'form', f_id, 'public_link', con, acc, jsonb_build_object('form_id', f_id, 'sample', true), now() - make_interval(days => r.form_days), 'attribution-demo:' || r.i || ':f')
        on conflict (tenant_id, dedupe_key) do nothing;
      end if;

      if r.deal_days is not null then
        seq_opp := seq_opp + 1;
        insert into opportunities (tenant_id, ref, account_id, contact_id, title, stage, outcome, amount, currency, probability, source, owner_id, created_at, closed_at)
        values (t.id, 'OPP-' || lpad(seq_opp::text, 4, '0'), acc, con,
                'Sample deal ' || r.i || ' (attribution sample)',
                case r.outcome when 'won' then 'won' when 'lost' then 'lost' else 'propose' end,
                r.outcome, r.amount, 'SAR', case r.outcome when 'won' then 100 when 'lost' then 0 else 50 end, 'campaign', u,
                now() - make_interval(days => r.deal_days),
                case when r.closed_days is null then null else now() - make_interval(days => r.closed_days) end);
      end if;
    end loop;
  end loop;
end
$seed$;
