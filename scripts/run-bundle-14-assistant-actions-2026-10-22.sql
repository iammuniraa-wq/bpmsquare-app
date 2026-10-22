-- run-bundle-14-assistant-actions-2026-10-22.sql
-- Assistant audit trail and web research. Paste into the Supabase SQL editor of each database (dev, then production).
-- = migration 0205, then the demo switch (which only touches is_demo workspaces).
-- Safe to run twice. Independent of the other bundles; change_log.via is added only when change_log exists.


-- 0205_assistant_actions.sql
--
-- The assistant's audit trail (docs/design/assistant-smarter.md sections 2, 6 and 8; docs/nova-assistant-architecture.md
-- section 9).
--
--   assistant_actions  one row for each thing the assistant did that reaches outside the chat or changes data: a web
--                      search today (kind = 'web_search': the query, the source addresses, the tokens, who, when),
--                      later a create or an update from a confirm card. This is also the audit standard Nova Crew
--                      adopts. It never holds a field value or a person's contact details: a search query is limited
--                      to the person's own words and a company name before it is sent, and the answer text is not stored.
--   change_log.via     which surface made a change ('assistant' when a confirm card did); null for the ordinary UI.
--                      Added here so the create routes and Change History can use it without a second migration.
--
-- Access: assistant_actions is written ONLY by the server (service role) and members may only READ: no insert, update
-- or delete policy exists, so a member cannot forge or erase an audit row with their own session (the 0078 / 0199
-- lesson: a table whose point is accountability must not be writable by the people it holds to account). A person reads
-- their own rows; an admin of the workspace reads the workspace's.
--
-- Additive and idempotent. Until it is applied the assistant still searches the web behind its flag and simply writes
-- no audit row (a missing table is read as "nothing to record", never as an error).

create table if not exists assistant_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid,
  conversation_id uuid,
  kind text not null,                       -- web_search | create | update | guide
  action_key text,
  route text,                               -- the screen the person was on (path only)
  card jsonb,                               -- the confirm card as shown (create / update), null otherwise
  params jsonb not null default '{}'::jsonb,
  status text not null default 'done',      -- done | refused | failed | pending
  result jsonb,
  sources jsonb,                            -- [{ title, url }] for a web search
  tokens integer not null default 0,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create index if not exists assistant_actions_tenant_time_idx on assistant_actions (tenant_id, created_at desc);
create index if not exists assistant_actions_user_idx on assistant_actions (tenant_id, user_id, created_at desc);

alter table assistant_actions enable row level security;

drop policy if exists "assistant_actions: own or admin read" on assistant_actions;
create policy "assistant_actions: own or admin read" on assistant_actions for select
  using (
    tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin')
    or (user_id = auth.uid() and tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  );

do $$ begin
  if to_regclass('public.change_log') is null then
    return;
  end if;
  execute 'alter table change_log add column if not exists via text';
end $$;


-- ---- seed: scripts/seed-assistant-web-demo.sql ----
-- Assistant web research: demo switch for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0205_assistant_actions.sql (the flag works without it, but no audit row is written).
-- Idempotent. Touches ONLY tenants where is_demo = true that already have the AI assistant on; never a client.
--
-- It switches the ai_assistant_web flag on. Nothing else is seeded: a web search leaves its own audit row.

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"ai_assistant_web": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'ai_assistant')::boolean, false) = true
   and coalesce((features ->> 'ai_assistant_web')::boolean, false) = false;
