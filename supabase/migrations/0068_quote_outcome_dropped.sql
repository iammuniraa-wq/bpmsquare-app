-- 0068_quote_outcome_dropped.sql
-- Adds "dropped" as a third closed-outcome value alongside won/lost (0036).
-- Status and outcome are being decoupled further (see 0069): status only
-- says whether a quote is closed, outcome says what happened. "Lost" (an
-- active rejection) and "dropped" (the deal went cold, no decision) mean
-- different things for win-rate reporting, so they need to stay distinct
-- values rather than being folded into one.

alter table quotes drop constraint if exists quotes_outcome_check;
alter table quotes add constraint quotes_outcome_check
  check (outcome in ('open', 'won', 'lost', 'dropped'));
