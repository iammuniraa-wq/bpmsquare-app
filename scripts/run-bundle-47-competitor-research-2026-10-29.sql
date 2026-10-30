-- run-bundle-47-competitor-research-2026-10-29.sql
-- Competitors found by market research (status, origin, evidence on opportunity_competitors). = migration 0239. Safe to run twice. Paste into the Supabase SQL editor of each database (dev, then production, then KAMCO). Needs 0229 (bundle 40).

-- 0239: Competitors found by market research.
-- KAMCO feedback, slice 7 (docs/design/kamco-feedback-build-spec.md section 9). Needs 0229 (opportunity_competitors).
--
-- A competitor can now be PROPOSED by "Suggest from market research" before the team has accepted it:
--
--   status    proposed (came from research, not yet part of the tender), accepted (the team's own list; every earlier row), rejected
--             (kept so a later research run does not propose the same company again)
--   origin    manual (typed by a person) or research (proposed by the market research)
--   evidence  the sourced facts behind a proposal, as JSON: facts with a source link each, a price statement and a win statement
--             when a page states them. Never an invented figure; the application drops anything without a cited source.
--
-- RLS is unchanged: 0229 already gives members SELECT only and every write goes through the service-role routes.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Competitors tab lists every competitor as one the team
-- added, hides the research button's results and says a database update is needed for research; nothing else changes (42703 / PGRST204
-- are read as "not there yet").

do $$
begin
  if to_regclass('public.opportunity_competitors') is null then
    raise exception 'Run 0229 (opportunity_competitors) first, then run this again.';
  end if;
end $$;

alter table opportunity_competitors add column if not exists status text not null default 'accepted' check (status in ('proposed', 'accepted', 'rejected'));
alter table opportunity_competitors add column if not exists origin text not null default 'manual' check (origin in ('manual', 'research'));
alter table opportunity_competitors add column if not exists evidence jsonb;

create index if not exists opportunity_competitors_status_idx on opportunity_competitors (tenant_id, opportunity_id, status);
