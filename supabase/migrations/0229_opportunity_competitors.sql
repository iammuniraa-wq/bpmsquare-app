-- 0229: Competitors of a tender deal.
-- GCC tender deals, the Competitors tab (docs/design/gcc-tender-deals.md section 22). Needs 0120 (opportunities).
--
-- opportunity_competitors: the companies we expect to bid against on one deal, each with a website, a country, whether they are expected to
-- price below / similar to / above us, what they are strong at, a note, and whether they won. At most one competitor per deal is the
-- winner (a partial unique index); marking one is how "who won" is recorded, and the application also writes the winner's name to
-- opportunity_tenders.winning_bidder and opportunities.competitor so every earlier screen keeps working. A name is unique within a deal,
-- ignoring case, so "Who won: Someone else" can find or create its row safely.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. Competitor intelligence is
-- commercially sensitive and drives the recorded winner, so every write is a service-role API route that has already checked the tenant,
-- the deal and the caller's access to the Pipeline.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Competitors tab says a database update is needed and
-- nothing else changes (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.opportunities') is null then
    raise exception 'Run 0120 (opportunities) first, then run this again.';
  end if;
end $$;

create table if not exists opportunity_competitors (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 200),
  website         text check (website is null or char_length(website) <= 300),
  country         text check (country is null or char_length(country) <= 80),
  expected_price  text check (expected_price is null or expected_price in ('lower', 'similar', 'higher')),
  strengths       text check (strengths is null or char_length(strengths) <= 1000),
  notes           text check (notes is null or char_length(notes) <= 2000),
  is_winner       boolean not null default false,
  sort            int not null default 0,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists opportunity_competitors_deal on opportunity_competitors (tenant_id, opportunity_id);
create unique index if not exists opportunity_competitors_one_winner on opportunity_competitors (opportunity_id) where is_winner;
create unique index if not exists opportunity_competitors_name_unique on opportunity_competitors (opportunity_id, lower(name));

alter table opportunity_competitors enable row level security;
drop policy if exists "opportunity_competitors: tenant read" on opportunity_competitors;
create policy "opportunity_competitors: tenant read" on opportunity_competitors for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
