-- 0204_assistant_briefings.sql
--
-- The daily briefing (docs/design/assistant-smarter.md section 4): what a person did yesterday, what is open today and
-- where to focus, worked out from their own records on their first open of the day and kept here so the next open of
-- the same day reads one row instead of a dozen queries.
--
--   assistant_briefings   one row per (workspace, person, day). `data` is the briefing as shown (counts, labels, reasons and
--                         links only; no field values), `wording` the AI phrasing of it when that is on (later), `lang` the
--                         language the wording was made in, `tokens` what the wording cost.
--
-- Access: a person may READ their own row (user_id = auth.uid() and a member of the workspace). There is deliberately NO
-- insert/update/delete policy: only the server writes, through the service role with the workspace and the person in the
-- filter, so a member cannot forge a briefing for themselves or anyone else (the 2026-08-12 / 2026-10-21 lesson).
-- Nothing is added to `tenants`, so the column-grant rule of 0200 does not apply.
--
-- Additive and idempotent. Until it is applied the briefing is worked out on every open and not stored.

create table if not exists assistant_briefings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  user_id      uuid not null,
  day          date not null,
  lang         text,
  data         jsonb not null default '{}'::jsonb,
  wording      jsonb,
  tokens       integer not null default 0,
  computed_at  timestamptz not null default now()
);

create unique index if not exists assistant_briefings_day_key on assistant_briefings (tenant_id, user_id, day);

alter table assistant_briefings enable row level security;

drop policy if exists "assistant_briefings: own read" on assistant_briefings;
create policy "assistant_briefings: own read" on assistant_briefings for select
  using (user_id = auth.uid()
     and tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
