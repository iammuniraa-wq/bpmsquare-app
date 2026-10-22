-- Company analysis: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0206_company_analysis.sql (it fails cleanly before that: the table is not there).
-- Idempotent: a company that already has a saved analysis in the workspace is left alone, so it is safe to run twice.
-- Touches ONLY tenants where is_demo = true; never a client.
--
-- Per demo tenant it:
--   1. switches the ai_assistant_web flag on where the AI assistant is already on (the flag the analysis hangs off);
--   2. picks up to three existing accounts (the "(Sample)" accounts of the Buying signals demo first) and gives each a
--      saved analysis, so the Account 360 card "Company analysis" and the slider have something to show:
--        1st account: analysed 3 days ago, "Worth following up: Yes" (an award, a hiring push, a new project);
--        2nd account: analysed yesterday, "Not now" (an expansion and a tender it is named in);
--        3rd account: analysed 9 days ago, so it reads as older than seven days and offers Refresh (one piece of bad news).
--   3. gives an account without a website a made-up one on the reserved .example domain, because the saved analysis is
--      found by the website's domain. Nothing is fetched from it: .example never resolves.
-- The findings are clearly sample text and carry "sample": true. Nothing is searched, nothing is sent, no AI is used.
-- After running it, press "Rescore now" on Buying signals: the saved findings then appear in "They are moving".
--
-- To remove it: delete from company_analyses where data ->> 'sample' = 'true';

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"ai_assistant_web": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'ai_assistant')::boolean, false) = true
   and coalesce((features ->> 'ai_assistant_web')::boolean, false) = false;

do $seed$
declare
  t record;
  a record;
  n int;
  v_site text;
  v_domain text;
  v_name text;
  v_ago interval;
  v_computed timestamptz;
  v_claims jsonb;
  v_sources jsonb;
  v_sentence jsonb;
  v_verdict text;
  v_fit text;
  v_stage text;
  v_u1 text;
  v_u2 text;
  v_u3 text;
begin
  for t in select id from tenants where is_demo = true loop
    n := 0;
    for a in
      select id, name, website from accounts
       where tenant_id = t.id
       order by (name like '%(Sample)') desc, created_at, name
       limit 3
    loop
      n := n + 1;
      v_name := regexp_replace(a.name, ' \(Sample\)$', '');
      v_site := nullif(trim(coalesce(a.website, '')), '');
      if v_site is null then
        v_site := 'https://' || regexp_replace(lower(v_name), '[^a-z0-9]+', '', 'g') || '.example';
        update accounts set website = v_site where id = a.id and tenant_id = t.id;
      end if;
      v_domain := lower(regexp_replace(v_site, '^[a-zA-Z][a-zA-Z0-9+.-]*://(www\.)?', ''));
      v_domain := regexp_replace(split_part(split_part(split_part(v_domain, '/', 1), '?', 1), '#', 1), ':[0-9]+$', '');

      if exists (select 1 from company_analyses where tenant_id = t.id and company_key = v_domain) then
        continue;
      end if;

      v_u1 := 'https://news.example.com/sample/' || n || '-1';
      v_u2 := 'https://news.example.com/sample/' || n || '-2';
      v_u3 := 'https://jobs.example.com/sample/' || n || '-3';

      if n = 1 then
        v_ago := interval '3 days'; v_verdict := 'call_this_week'; v_fit := 'strong'; v_stage := 'comparing';
        v_sentence := jsonb_build_object('text', 'They won a large package last week and are hiring, which fits what you sell.', 'byAi', true, 'forLabel', 'call_this_week');
        v_claims := jsonb_build_array(
          jsonb_build_object('text', v_name || ' won a large housing package', 'kind', 'award', 'confidence', 'found', 'stale', false,
            'publishedOn', to_char(current_date - 6, 'YYYY-MM-DD'),
            'source', jsonb_build_object('id', 's' || substr(md5(v_u1), 1, 7), 'url', v_u1, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
          jsonb_build_object('text', v_name || ' is hiring site engineers for the new package', 'kind', 'hiring', 'confidence', 'found', 'stale', false,
            'publishedOn', to_char(current_date - 20, 'YYYY-MM-DD'),
            'source', jsonb_build_object('id', 's' || substr(md5(v_u3), 1, 7), 'url', v_u3, 'title', 'Sample job posting', 'publisher', 'jobs.example.com', 'fetchedAt', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
          jsonb_build_object('text', v_name || ' started a second production line', 'kind', 'project', 'confidence', 'found', 'stale', false,
            'publishedOn', to_char(current_date - 41, 'YYYY-MM-DD'),
            'source', jsonb_build_object('id', 's' || substr(md5(v_u2), 1, 7), 'url', v_u2, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
        v_sources := jsonb_build_array(
          jsonb_build_object('id', 's' || substr(md5(v_u1), 1, 7), 'url', v_u1, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          jsonb_build_object('id', 's' || substr(md5(v_u3), 1, 7), 'url', v_u3, 'title', 'Sample job posting', 'publisher', 'jobs.example.com', 'fetchedAt', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          jsonb_build_object('id', 's' || substr(md5(v_u2), 1, 7), 'url', v_u2, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      elsif n = 2 then
        v_ago := interval '1 day'; v_verdict := 'watch'; v_fit := 'partial'; v_stage := 'looking';
        v_sentence := jsonb_build_object('text', 'They are growing, but nothing points to a purchase yet, so keep watching.', 'byAi', true, 'forLabel', 'watch');
        v_claims := jsonb_build_array(
          jsonb_build_object('text', v_name || ' opened a second site', 'kind', 'expansion', 'confidence', 'found', 'stale', false,
            'publishedOn', to_char(current_date - 12, 'YYYY-MM-DD'),
            'source', jsonb_build_object('id', 's' || substr(md5(v_u1), 1, 7), 'url', v_u1, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
          jsonb_build_object('text', v_name || ' is named in a public supply tender', 'kind', 'tender', 'tenderRole', 'named', 'confidence', 'found', 'stale', false,
            'publishedOn', to_char(current_date - 30, 'YYYY-MM-DD'),
            'source', jsonb_build_object('id', 's' || substr(md5(v_u2), 1, 7), 'url', v_u2, 'title', 'Sample tender notice', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
        v_sources := jsonb_build_array(
          jsonb_build_object('id', 's' || substr(md5(v_u1), 1, 7), 'url', v_u1, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          jsonb_build_object('id', 's' || substr(md5(v_u2), 1, 7), 'url', v_u2, 'title', 'Sample tender notice', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      else
        v_ago := interval '9 days'; v_verdict := 'not_enough'; v_fit := 'unknown'; v_stage := 'quiet';
        v_sentence := null;
        v_claims := jsonb_build_array(
          jsonb_build_object('text', v_name || ' reported delays on two projects', 'kind', 'risk', 'confidence', 'found', 'stale', false,
            'publishedOn', to_char(current_date - 50, 'YYYY-MM-DD'),
            'source', jsonb_build_object('id', 's' || substr(md5(v_u1), 1, 7), 'url', v_u1, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '9 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
        v_sources := jsonb_build_array(
          jsonb_build_object('id', 's' || substr(md5(v_u1), 1, 7), 'url', v_u1, 'title', 'Sample article', 'publisher', 'news.example.com', 'fetchedAt', to_char(now() - interval '9 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      end if;

      v_computed := now() - v_ago;
      insert into company_analyses (
        tenant_id, company_key, account_id, name, domain, data, sources, version, searches, computed_at, expires_at
      ) values (
        t.id, v_domain, a.id, v_name, v_domain,
        jsonb_build_object(
          'v', 1, 'sample', true, 'claims', v_claims, 'checkThese', '[]'::jsonb, 'size', null, 'people', '[]'::jsonb,
          'sources', v_sources, 'sentence', v_sentence,
          'snapshot', jsonb_build_object('claims', '[]'::jsonb, 'fit', v_fit, 'stage', v_stage, 'verdict', v_verdict)
        ),
        (select coalesce(jsonb_agg(jsonb_build_object('url', s ->> 'url', 'title', s ->> 'title', 'publisher', s ->> 'publisher', 'fetched_at', s ->> 'fetchedAt')), '[]'::jsonb)
           from jsonb_array_elements(v_sources) as s),
        1, 3, v_computed, v_computed + interval '7 days'
      )
      on conflict (tenant_id, company_key) do nothing;
    end loop;
  end loop;
end
$seed$;
