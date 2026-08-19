-- Nova pillar 3 (task #84): comments on records, with @mentions.
-- One table for every object family (object_type + object_id), same
-- addressing scheme change_log already uses -- the record timeline merges
-- the two streams. Mentions are stored as the mentioned members' emails
-- (resolved at compose time); the Nova inbox (pillar 4) reads them.
--
-- RLS: tenant members read and WRITE their tenant's comments, but there is
-- deliberately NO update/delete policy -- a comment is part of the record's
-- history, append-only from the app's point of view (same convention as
-- change_log, 0050).

create table if not exists record_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  object_type text not null,
  object_id uuid not null,
  author_id uuid,
  author_email text,
  body text not null,
  mentions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists record_comments_target_idx
  on record_comments (tenant_id, object_type, object_id, created_at desc);

alter table record_comments enable row level security;

drop policy if exists "record_comments: tenant read" on record_comments;
create policy "record_comments: tenant read" on record_comments for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "record_comments: tenant insert" on record_comments;
create policy "record_comments: tenant insert" on record_comments for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
