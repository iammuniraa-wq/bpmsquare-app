-- Backs the dedup check in createCampaignInterestLeadLive (src/lib/data/live.ts)
-- with a real constraint, closing a race: two near-simultaneous clicks on the
-- same "I'm interested" link (a double-click, or a mail client/security
-- scanner prefetching the link) could otherwise both pass the
-- check-then-insert's SELECT before either INSERT lands, creating duplicate
-- leads for the same account+campaign. The app now treats a unique-violation
-- on this index as "already exists" rather than an error.
create unique index if not exists leads_account_campaign_unique_idx
  on leads (account_id, source_campaign_id)
  where source_campaign_id is not null;
