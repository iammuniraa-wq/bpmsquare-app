-- 0142: Newsletter Studio, the campaign side (docs/newsletter-studio-architecture.md
-- sections 3 and 7).
--  * marketing_campaigns: which newsletter VERSION a campaign sends, which
--    languages it includes, the fallback language and the consent topic.
--  * marketing_campaign_recipients: the language each person got, the contact
--    the recipient resolved to, and three new skip reasons the consent gate
--    and the language rule can produce.
--  * marketing_link_clicks: one row per click on a tracked link. The click
--    route is the only writer (service-role client, tenant-filtered); members
--    can read their tenant's rows and nothing else (select-only, the WFM
--    lesson in MULTI_TENANT_GUARDRAILS.md: a click row feeds scores, so a
--    member must not be able to forge one through PostgREST).
--
-- Additive: every new column is nullable or defaulted, and the campaign send
-- route only takes its new branch when newsletter_version_id is set, so
-- running this late (or never) changes nothing for an existing campaign.
-- Requires 0141 for the foreign key to newsletter_versions.

alter table marketing_campaigns add column if not exists newsletter_version_id uuid references newsletter_versions(id) on delete set null;
alter table marketing_campaigns add column if not exists languages text[] not null default '{}';
alter table marketing_campaigns add column if not exists fallback_language text;
alter table marketing_campaigns add column if not exists topic text;

alter table marketing_campaign_recipients add column if not exists lang text;
alter table marketing_campaign_recipients add column if not exists contact_id uuid;

alter table marketing_campaign_recipients drop constraint if exists marketing_campaign_recipients_status_check;
alter table marketing_campaign_recipients add constraint marketing_campaign_recipients_status_check
  check (status in ('pending', 'sent', 'failed', 'skipped_opt_out', 'skipped_no_email',
                    'skipped_no_consent', 'skipped_no_contact', 'skipped_no_language'));

create table if not exists marketing_link_clicks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  campaign_id         uuid not null references marketing_campaigns(id) on delete cascade,
  recipient_id        uuid not null references marketing_campaign_recipients(id) on delete cascade,
  contact_id          uuid,
  link_index          int not null,
  topic_id            text,
  lang                text,
  clicked_at          timestamptz not null default now(),
  -- Coarse on purpose ("Chrome", "Apple Mail"): no IP, no device model.
  user_agent_family   text
);

create index if not exists marketing_link_clicks_campaign_idx on marketing_link_clicks (tenant_id, campaign_id, link_index);
create index if not exists marketing_link_clicks_recipient_idx on marketing_link_clicks (recipient_id);

alter table marketing_link_clicks enable row level security;
drop policy if exists "marketing_link_clicks: tenant read" on marketing_link_clicks;
create policy "marketing_link_clicks: tenant read" on marketing_link_clicks for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
