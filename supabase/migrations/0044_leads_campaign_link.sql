-- Attributes a lead back to the campaign that generated it, via the
-- "I'm interested" click-through link added to every sent campaign email
-- (see src/lib/campaignInterestLink.ts and
-- /api/marketing/interest/[campaignId]/[accountId]/[token]).
alter table leads add column if not exists source_campaign_id uuid references marketing_campaigns(id);

alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check check (source in ('oem_referral', 'amc', 'direct', 'campaign'));

create index if not exists leads_source_campaign_idx on leads (source_campaign_id) where source_campaign_id is not null;
