-- 0169: Journeys, how a "Send newsletter version" step reaches the ONE send path.
-- The newsletter send path (src/lib/newsletter/send.ts) is built around a campaign,
-- so a journey step keeps one quiet campaign per step. These two columns mark it:
--   * the Campaigns list hides any campaign with journey_id set (it is not a
--     campaign anyone sends by hand), and
--   * the runner finds the step's campaign again instead of making a new one.
-- Additive and nullable: running this late changes nothing for existing campaigns.
-- Requires 0165 (and 0142 for the newsletter columns the campaign already uses).

alter table marketing_campaigns add column if not exists journey_id uuid references journeys(id) on delete set null;
alter table marketing_campaigns add column if not exists journey_step_id text;
create unique index if not exists marketing_campaigns_journey_step_uniq
  on marketing_campaigns (tenant_id, journey_id, journey_step_id) where journey_id is not null;
