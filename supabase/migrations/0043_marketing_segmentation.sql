-- Segmentation: rule-based target groups (SAP Marketing Cloud-style) built
-- from a drag-and-drop set of attribute filters, on top of the existing
-- account_types/include/exclude/manual_emails mechanism (kept as-is for
-- backward compatibility with groups/campaigns saved before this).
--
-- `filters` is a flexible jsonb array of {id, field, operator, value} --
-- deliberately schemaless so future signal types (contact enrichment score,
-- sentiment, news mentions) can be added as new filter fields later without
-- another migration; see src/lib/marketingSegmentation.ts for the field
-- registry and evaluator that give this array meaning.
alter table marketing_target_groups add column if not exists filters jsonb not null default '[]';
alter table marketing_target_groups add column if not exists match text not null default 'all' check (match in ('all', 'any'));

alter table marketing_campaigns add column if not exists filters jsonb not null default '[]';
alter table marketing_campaigns add column if not exists match text not null default 'all' check (match in ('all', 'any'));
