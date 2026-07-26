-- Records which curated starting template (if any) a campaign was built
-- from, and the plain-text custom message merged into it -- lets a draft
-- be re-opened and the message re-edited without losing the template
-- association. See src/lib/marketingTemplates.ts.
alter table marketing_campaigns add column if not exists template_id text;
alter table marketing_campaigns add column if not exists custom_message text;
