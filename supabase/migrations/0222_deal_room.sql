-- 0222_deal_room.sql
--
-- GCC tender deals, slice 2: the internal Deal Room (docs/design/gcc-tender-deals.md section 4 as changed by section 10).
-- One room per tender deal where the workspace's own people discuss the bid instead of passing e-mail around. INTERNAL ONLY:
-- there is no guest, no code, no link and no public path in this file or in the application. Needs 0120 (opportunities); the
-- room is only offered on a deal that has an opportunity_tenders row (0220), a rule the application checks, not a foreign key.
--
-- 1. deal_rooms: one per deal (unique on opportunity_id).
-- 2. deal_room_members: who follows the room. The deal's owner and team are added when the room is made; others by name. The
--    row also carries what the unread count and the e-mail digest need: last_seen_at (last time the person had the room open),
--    last_read_at (everything up to here is read) and last_digest_at (the last digest e-mail, at most one per 15 minutes).
-- 3. deal_room_messages: append-only. A message is plain text (the screen never renders it as HTML), optionally a question
--    (owner, due date, open / answered) or a pinned one-line decision. Delete is a SOFT delete (deleted_at / deleted_by): the row
--    stays, the text is never sent to a screen again. `channel` only ever holds 'team'; the column is here so a client channel
--    can be added later by widening one check, not by migrating the table.
-- 4. deal_room_files: a file posted with a message, kept in the private bucket below and downloaded through a short-lived signed link.
-- 5. The private bucket `deal-room-files`: no storage policy grants anon or authenticated anything, so neither can list or read it;
--    the application uploads and signs with the service role. First path segment is the tenant id.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; the 0199 lesson): all four tables carry a tenant SELECT policy and NOTHING that writes. Every
-- write is a service-role API route that has already checked the tenant, the deal, the caller's access to the Pipeline and every
-- foreign id, so a member cannot post as someone else, edit or un-delete a message, or forge a read marker through PostgREST.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Room tab says a database update is needed and
-- nothing else changes (42P01 / PGRST205 are read as "not there yet").

create table if not exists deal_rooms (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (opportunity_id)
);

create index if not exists deal_rooms_tenant_idx on deal_rooms (tenant_id);

create table if not exists deal_room_members (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  room_id         uuid not null references deal_rooms(id) on delete cascade,
  user_id         uuid not null,
  added_by        uuid,
  added_at        timestamptz not null default now(),
  last_seen_at    timestamptz,
  last_read_at    timestamptz,
  last_digest_at  timestamptz,
  unique (room_id, user_id)
);

create index if not exists deal_room_members_user_idx on deal_room_members (tenant_id, user_id);

create table if not exists deal_room_messages (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  room_id           uuid not null references deal_rooms(id) on delete cascade,
  channel           text not null default 'team' check (channel = 'team'),
  kind              text not null default 'message' check (kind in ('message', 'question', 'decision')),
  body              text not null check (char_length(body) between 1 and 4000),
  parent_id         uuid references deal_room_messages(id) on delete cascade,
  author_id         uuid not null,
  mentions          uuid[] not null default '{}',
  question_owner_id uuid,
  question_due      date,
  question_status   text check (question_status in ('open', 'answered')),
  answered_at       timestamptz,
  answered_by       uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  created_at        timestamptz not null default now(),
  -- Moves whenever the row changes (answered, removed), so a poll that asks "what changed since" finds it. Equals created_at on insert.
  updated_at        timestamptz not null default now(),
  check ((kind = 'question') = (question_status is not null))
);

create index if not exists deal_room_messages_room_idx on deal_room_messages (room_id, created_at);
create index if not exists deal_room_messages_changed_idx on deal_room_messages (room_id, updated_at);
create index if not exists deal_room_messages_open_questions_idx on deal_room_messages (tenant_id, room_id) where kind = 'question' and question_status = 'open' and deleted_at is null;

create table if not exists deal_room_files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  room_id       uuid not null references deal_rooms(id) on delete cascade,
  message_id    uuid not null references deal_room_messages(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,
  mime_type     text,
  size_bytes    bigint not null default 0,
  uploaded_by   uuid not null,
  created_at    timestamptz not null default now()
);

create index if not exists deal_room_files_message_idx on deal_room_files (room_id, message_id);

alter table deal_rooms         enable row level security;
alter table deal_room_members  enable row level security;
alter table deal_room_messages enable row level security;
alter table deal_room_files    enable row level security;

drop policy if exists "deal_rooms: tenant read" on deal_rooms;
create policy "deal_rooms: tenant read" on deal_rooms for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "deal_room_members: tenant read" on deal_room_members;
create policy "deal_room_members: tenant read" on deal_room_members for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "deal_room_messages: tenant read" on deal_room_messages;
create policy "deal_room_messages: tenant read" on deal_room_messages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "deal_room_files: tenant read" on deal_room_files;
create policy "deal_room_files: tenant read" on deal_room_files for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('deal-room-files', 'deal-room-files', false, 15728640)
on conflict (id) do nothing;
