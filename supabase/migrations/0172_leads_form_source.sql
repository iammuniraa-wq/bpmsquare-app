-- 0172: a lead can come from a form (docs/marketing-platform-architecture.md 5.1).
-- leads.source gains 'form' and leads gains source_form_id. Additive: every existing
-- lead keeps its source and the Vikas leads list is unchanged. Requires 0170.
--
-- The app degrades while this is pending: a form submit then files the lead with
-- source 'direct' and no form link, rather than losing it.

alter table leads add column if not exists source_form_id uuid references forms(id) on delete set null;

alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check check (source in ('oem_referral', 'amc', 'direct', 'campaign', 'form'));

create index if not exists leads_source_form_idx on leads (tenant_id, source_form_id) where source_form_id is not null;
