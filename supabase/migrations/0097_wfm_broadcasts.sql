-- 0097: broadcast messages — announcements from a supervisor/admin to every
-- employee in the tenant (PagarBook's "Broadcast Messages"). Read state is
-- tracked per LOGIN (user_id) so the portal can show an unread banner.
--
-- RLS follows the WFM convention: tenant-scoped SELECT, no write policy at
-- all — creation/read-marking go through the service-role API routes, which
-- gate composing to supervisors/admins.

create table if not exists wfm_broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  title text not null,
  body text not null default '',
  created_by uuid,               -- auth user of the composer
  created_by_name text,          -- denormalized for display (composer may leave)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists wfm_broadcasts_tenant_idx
  on wfm_broadcasts (tenant_id, created_at desc);

alter table wfm_broadcasts enable row level security;

create policy "wfm_broadcasts: tenant read" on wfm_broadcasts for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists wfm_broadcast_reads (
  tenant_id uuid not null references tenants(id),
  broadcast_id uuid not null references wfm_broadcasts(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);

alter table wfm_broadcast_reads enable row level security;

create policy "wfm_broadcast_reads: own rows" on wfm_broadcast_reads for select
  using (user_id = auth.uid());
