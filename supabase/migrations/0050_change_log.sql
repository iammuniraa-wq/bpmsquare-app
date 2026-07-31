-- 0050_change_log.sql
-- Transaction-level change history for core objects: who changed what, when,
-- field by field. Written from API routes via src/lib/changeLog.ts.
--
-- Audit-integrity note: tenant members can SELECT and INSERT their own
-- tenant's rows, but there are deliberately NO update/delete policies --
-- history is append-only from a tenant user's point of view. (The service
-- role bypasses RLS as always; nothing in app code updates or deletes rows.)
--
-- PII note: values for encrypted fields (account/contact phone, email,
-- gstin) are never stored here in plaintext -- changeLog.ts records those
-- as a redacted marker. The `changes` column therefore never needs
-- field-level encryption of its own.

create table change_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  object_type text not null,
  object_id uuid not null,
  -- Human-readable identifier at the time of the change (account name,
  -- quote ref) so history reads without joins -- and survives the record's
  -- later deletion or rename.
  object_label text,
  action text not null check (action in ('create', 'update', 'delete')),
  -- Array of { field, from, to, redacted? } entries; empty for create/delete.
  changes jsonb not null default '[]'::jsonb,
  actor_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);

create index change_log_record_idx on change_log (tenant_id, object_type, object_id, created_at desc);
create index change_log_tenant_time_idx on change_log (tenant_id, created_at desc);

alter table change_log enable row level security;

create policy "change_log: tenant read" on change_log for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "change_log: tenant insert" on change_log for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
