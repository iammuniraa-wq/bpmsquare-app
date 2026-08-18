-- Loss Intelligence (engagement layer, owner go-ahead 2026-08-18): every
-- lost/dropped quotation carries a STRUCTURED reason plus a free-text note.
-- The structure is the point -- aggregable for the dashboard's loss-mix
-- view, and queryable by the AI (/api/v1/ask) so "why are we losing?" has
-- data to answer with, instead of anecdotes.
alter table quotes add column if not exists loss_reason text
  check (loss_reason is null or loss_reason in ('price','silent','competitor','budget','timing','other'));
alter table quotes add column if not exists loss_note text;
