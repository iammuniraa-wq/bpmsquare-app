-- Sample ABM programs for the DEMO tenant ONLY (run AFTER supabase/migrations/0180 to 0183, and after
-- 0137_domain_event.sql if you want the activity behind the progress). Never run on a real workspace:
-- it creates companies and people. Idempotent: skips everything once "Riyadh developers 2027" exists.
--
-- A Saudi precast maker's view (docs/abm-architecture.md section 13, phase A1):
--   Program "Riyadh developers 2027"   (new business)  12 targets from 12 clearly labelled SAMPLE accounts
--       funnel 12 > 11 reached > 7 engaged > 4 in talks > 3 in a deal > 1 won, three tiers, buying groups,
--       two companies that clicked but have no decision maker named yet (shown as a gap, held at Reached),
--       one company already won through a linked deal.
--   Program "Repeat customers 2027"    (expansion)     6 targets, one of them also in the first program
--       at a different tier and progress.
-- Every account name ends in "(sample)"; people are invented. Nothing is sent to anyone.
-- Also turns the abm and marketing features on for the demo tenant only.

do $$
declare
  t uuid;
  u uuid;
  p1 uuid;
  p2 uuid;
  seq_acc int;
  seq_con int;
  seq_opp int;
  seq_abm int;
  r record;
  m record;
  acc uuid;
  tgt uuid;
  con_dm uuid;
  con_inf uuid;
  con_user uuid;
  deal uuid;
  deal_ref text;
  ev_at timestamptz;
  fnames text[] := array['Khalid','Noura','Faisal','Reem','Omar','Huda','Saud','Maha','Turki','Lama','Abdullah','Sara'];
  lnames text[] := array['Al-Harbi','Al-Otaibi','Al-Qahtani','Al-Dosari','Al-Shehri','Al-Ghamdi','Al-Zahrani','Al-Mutairi','Al-Subaie','Al-Anazi','Al-Rashed','Al-Fahad'];
  has_events boolean;
begin
  select id into t from tenants where is_demo = true limit 1;
  if t is null then
    raise notice 'No demo tenant -- nothing seeded';
    return;
  end if;
  if exists (select 1 from abm_programs where tenant_id = t and name = 'Riyadh developers 2027') then
    raise notice 'ABM demo already seeded -- nothing to do';
    return;
  end if;
  select user_id into u from tenant_users where tenant_id = t order by user_id limit 1;
  has_events := to_regclass('public.domain_event') is not null;

  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) into seq_acc from accounts where tenant_id = t and ref ~ '^ACC-\d+$';
  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) into seq_con from contacts where tenant_id = t and ref ~ '^CON-\d+$';
  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) into seq_opp from opportunities where tenant_id = t and ref ~ '^OPP-\d+$';
  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) into seq_abm from abm_programs where tenant_id = t and ref ~ '^ABM-\d+$';

  insert into abm_programs (tenant_id, ref, name, kind, goal, goal_metric, goal_target, starts_on, ends_on, owner_user_id, status, default_tier, required_roles, created_by)
  values (t, 'ABM-' || lpad((seq_abm + 1)::text, 4, '0'), 'Riyadh developers 2027', 'new_business',
          'Win 3 precast supply contracts with Riyadh residential developers', 'deals_won', 3, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
          u, 'active', 'one_to_many', array['decision_maker', 'influencer'], u)
  returning id into p1;
  insert into abm_programs (tenant_id, ref, name, kind, goal, goal_metric, goal_target, starts_on, ends_on, owner_user_id, status, default_tier, required_roles, created_by)
  values (t, 'ABM-' || lpad((seq_abm + 2)::text, 4, '0'), 'Repeat customers 2027', 'expansion',
          'Sell a second precast package to two customers we already serve', 'deals_opened', 2, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
          u, 'active', 'one_to_few', array['decision_maker'], u)
  returning id into p2;

  -- i, name, city, industry, tier, progress
  for r in
    select * from (values
      (1,  'Najd Urban Development (sample)',        'Riyadh',   'Residential development', 'one_to_one',  'won'),
      (2,  'Al Rawabi Contracting (sample)',          'Riyadh',   'General contracting',     'one_to_one',  'deal_open'),
      (3,  'Tihama Residential Developers (sample)',  'Jeddah',   'Residential development', 'one_to_one',  'deal_open'),
      (4,  'Eastern Province Builders (sample)',      'Dammam',   'General contracting',     'one_to_few',  'in_talks'),
      (5,  'Qassim Housing Company (sample)',         'Buraydah', 'Residential development', 'one_to_few',  'engaged'),
      (6,  'Red Sea Construction Group (sample)',     'Jeddah',   'General contracting',     'one_to_few',  'engaged'),
      (7,  'Madinah Homes Development (sample)',      'Madinah',  'Residential development', 'one_to_few',  'engaged'),
      (8,  'Jeddah Towers Contracting (sample)',      'Jeddah',   'General contracting',     'one_to_many', 'reached'),
      (9,  'Diriyah Gate Builders (sample)',          'Riyadh',   'General contracting',     'one_to_many', 'reached'),
      (10, 'Hail Infrastructure Company (sample)',    'Hail',     'Infrastructure',          'one_to_many', 'reached'),
      (11, 'Abha Heights Developers (sample)',        'Abha',     'Residential development', 'one_to_many', 'reached'),
      (12, 'Jazan Coastal Builders (sample)',         'Jazan',    'General contracting',     'one_to_many', 'planned')
    ) as v(i, name, city, industry, tier, progress)
  loop
    select id into acc from accounts where tenant_id = t and name = r.name;
    if acc is null then
      seq_acc := seq_acc + 1;
      insert into accounts (tenant_id, ref, name, type, city, country, industry)
      values (t, 'ACC-' || lpad(seq_acc::text, 4, '0'), r.name, 'prospect', r.city, 'Saudi Arabia', r.industry)
      returning id into acc;
    end if;

    -- Three people per company: a project director (decides), a technical lead (influences), a procurement manager (uses).
    select id into con_dm from contacts where tenant_id = t and account_id = acc and role = 'Project Director' limit 1;
    if con_dm is null then
      seq_con := seq_con + 1;
      insert into contacts (tenant_id, ref, account_id, name, role)
      values (t, 'CON-' || lpad(seq_con::text, 4, '0'), acc, fnames[1 + (r.i * 3) % 12] || ' ' || lnames[1 + (r.i * 5) % 12], 'Project Director') returning id into con_dm;
      seq_con := seq_con + 1;
      insert into contacts (tenant_id, ref, account_id, name, role)
      values (t, 'CON-' || lpad(seq_con::text, 4, '0'), acc, fnames[1 + (r.i * 3 + 1) % 12] || ' ' || lnames[1 + (r.i * 5 + 2) % 12], 'Technical Lead') returning id into con_inf;
      seq_con := seq_con + 1;
      insert into contacts (tenant_id, ref, account_id, name, role)
      values (t, 'CON-' || lpad(seq_con::text, 4, '0'), acc, fnames[1 + (r.i * 3 + 2) % 12] || ' ' || lnames[1 + (r.i * 5 + 4) % 12], 'Procurement Manager') returning id into con_user;
    else
      select id into con_inf from contacts where tenant_id = t and account_id = acc and role = 'Technical Lead' limit 1;
      select id into con_user from contacts where tenant_id = t and account_id = acc and role = 'Procurement Manager' limit 1;
    end if;

    deal := null;
    if r.i in (1, 2, 3) then
      seq_opp := seq_opp + 1;
      deal_ref := 'OPP-' || lpad(seq_opp::text, 4, '0');
      insert into opportunities (tenant_id, ref, account_id, contact_id, title, stage, outcome, amount, currency, probability, source, owner_id, created_at, closed_at)
      values (t, deal_ref, acc, con_dm,
              case r.i when 1 then 'Precast wall panels, Najd Villas phase 2 (sample)' when 2 then 'Precast hollow-core slabs, Rawabi towers (sample)' else 'Precast boundary walls, Tihama gardens (sample)' end,
              case r.i when 1 then 'won' when 2 then 'negotiate' else 'propose' end,
              case r.i when 1 then 'won' else 'open' end,
              case r.i when 1 then 1800000 when 2 then 1200000 else 3000000 end, 'SAR',
              case r.i when 1 then 100 when 2 then 75 else 50 end, 'campaign', u,
              now() - interval '45 days', case r.i when 1 then now() - interval '6 days' else null end)
      returning id into deal;
    end if;

    -- Program 1 target. Created 60 days ago so the activity below falls inside its window.
    insert into abm_target_accounts (tenant_id, program_id, account_id, tier, progress, progress_source, progress_reason, progress_changed_at, progress_changed_by,
                                     owner_user_id, owner_source, next_step, next_step_due, next_step_user_id, added_via, added_by, opportunity_id, created_at)
    values (t, p1, acc, r.tier, r.progress,
            case when r.progress = 'in_talks' then 'manual' else 'rule' end,
            case r.progress
              when 'planned' then null
              when 'reached' then 'Someone in the buying group was sent an email, ' || to_char(now() - interval '20 days', 'FMDD Mon YYYY')
              when 'engaged' then 'Someone in the buying group clicked a link in an email, ' || to_char(now() - interval '12 days', 'FMDD Mon YYYY')
              when 'in_talks' then 'Site meeting held with the project director'
              when 'deal_open' then deal_ref || ' is open for this company'
              else deal_ref || ' was won (1,800,000), ' || to_char(now() - interval '6 days', 'FMDD Mon YYYY')
            end,
            now() - interval '6 days', case when r.progress = 'in_talks' then u else null end,
            u, 'program',
            case r.progress when 'planned' then 'Find the right person at the company' when 'reached' then 'Call the project director' when 'engaged' then 'Book a site meeting'
                            when 'in_talks' then 'Send the revised precast layout' when 'deal_open' then 'Agree delivery dates' else null end,
            case when r.progress in ('planned', 'reached', 'engaged', 'in_talks', 'deal_open') then (current_date + ((r.i * 3) % 14) - 4) else null end,
            u, 'segment', u, deal, now() - interval '60 days')
    returning id into tgt;

    if r.progress <> 'planned' then
      -- Buying group: companies 8 and 9 deliberately have NO decision maker (their gap shows on the program).
      if r.i not in (8, 9) then
        insert into abm_buying_group_members (tenant_id, target_account_id, contact_id, role, is_primary, owner_user_id, added_by, added_via)
        values (t, tgt, con_dm, 'decision_maker', true, u, u, 'manual');
      end if;
      insert into abm_buying_group_members (tenant_id, target_account_id, contact_id, role, is_primary, owner_user_id, added_by, added_via)
      values (t, tgt, con_inf, 'influencer', r.i in (8, 9), u, u, 'manual');
      if r.i <= 7 then
        insert into abm_buying_group_members (tenant_id, target_account_id, contact_id, role, owner_user_id, added_by, added_via)
        values (t, tgt, con_user, 'user', u, u, 'manual');
      end if;

      if has_events then
        -- What the progress above rests on: a delivery for everyone past Planned, a click for those past Reached
        -- and for the two companies held at Reached by their gap.
        insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, payload, occurred_at, dedupe_key)
        values (t, 'email.delivered', 'campaign', tgt, 'app', coalesce(case when r.i in (8, 9) then con_inf else con_dm end, con_inf), acc, '{"sample": true}'::jsonb, now() - interval '20 days', 'abm-demo:' || tgt::text || ':delivered')
        on conflict (tenant_id, dedupe_key) do nothing;
        if r.progress <> 'reached' or r.i in (8, 9) then
          insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, payload, occurred_at, dedupe_key)
          values (t, 'email.clicked', 'campaign', tgt, 'app', case when r.i in (8, 9) then con_inf else con_dm end, acc, '{"sample": true}'::jsonb, now() - interval '12 days', 'abm-demo:' || tgt::text || ':clicked')
          on conflict (tenant_id, dedupe_key) do nothing;
        end if;
      end if;
    end if;

    -- Program 2: a few of the same companies at a different tier and progress.
    if r.i in (1, 2, 3, 4, 5, 6) then
      insert into abm_target_accounts (tenant_id, program_id, account_id, tier, progress, progress_source, progress_reason, progress_changed_at, owner_user_id, owner_source, next_step, next_step_due, next_step_user_id, added_via, added_by, created_at)
      values (t, p2, acc, case when r.i <= 2 then 'one_to_few' else 'one_to_many' end,
              case r.i when 1 then 'engaged' when 2 then 'engaged' else 'planned' end, 'rule',
              case when r.i <= 2 then 'Someone in the buying group clicked a link in an email, ' || to_char(now() - interval '9 days', 'FMDD Mon YYYY') else null end,
              now() - interval '9 days', u, 'program',
              case when r.i <= 2 then 'Ask about the next building phase' else null end,
              case when r.i <= 2 then current_date + 7 else null end, u, 'manual', u, now() - interval '30 days')
      returning id into tgt;
      if r.i <= 2 then
        insert into abm_buying_group_members (tenant_id, target_account_id, contact_id, role, is_primary, owner_user_id, added_by, added_via)
        values (t, tgt, con_dm, 'decision_maker', true, u, u, 'manual');
        if has_events then
          insert into domain_event (tenant_id, name, object_type, object_id, source, contact_id, account_id, payload, occurred_at, dedupe_key)
          values (t, 'email.clicked', 'campaign', tgt, 'app', con_dm, acc, '{"sample": true}'::jsonb, now() - interval '9 days', 'abm-demo:' || tgt::text || ':clicked')
          on conflict (tenant_id, dedupe_key) do nothing;
        end if;
      end if;
    end if;
  end loop;

  update abm_programs set source_snapshot_at = now() - interval '60 days' where id in (p1, p2);
end $$;

-- Feature flags on for the demo tenant only (ABM needs Marketing).
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"abm": true, "marketing": true}'::jsonb
where is_demo = true;
