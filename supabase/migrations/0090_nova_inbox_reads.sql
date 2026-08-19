-- Nova pillar 4 (task #85): inbox read-state.
--
-- The inbox itself needs no new event table -- a notification IS a
-- record_comments row that mentions you (0089). All this stores is the
-- per-user "I've seen it" marker, so the bell count is personal and a
-- comment stays one row no matter how many people it mentions.
--
-- RLS: a member may only ever see or write THEIR OWN read markers, so
-- the policy is user-scoped as well as tenant-scoped. No update/delete
-- policy: marking read is an insert (idempotent via the unique index).

create table if not exists nova_inbox_reads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null,
  comment_id uuid not null references record_comments(id) on delete cascade,
  read_at timestamptz not null default now()
);

create unique index if not exists nova_inbox_reads_unique
  on nova_inbox_reads (user_id, comment_id);

alter table nova_inbox_reads enable row level security;

drop policy if exists "nova_inbox_reads: own read" on nova_inbox_reads;
create policy "nova_inbox_reads: own read" on nova_inbox_reads for select
  using (user_id = auth.uid()
     and tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "nova_inbox_reads: own insert" on nova_inbox_reads;
create policy "nova_inbox_reads: own insert" on nova_inbox_reads for insert
  with check (user_id = auth.uid()
          and tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
