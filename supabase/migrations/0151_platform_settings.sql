-- 0151: platform_settings -- settings that belong to the BPMSquare platform,
-- not to any tenant (first use: where the Process Design Studio's "Talk to us"
-- request is emailed, docs/process-design-studio-architecture.md section 2 step 6;
-- the owner names the address, nothing is hard-coded).
--
-- This is the one deliberate exception to "every table has tenant_id": a row
-- here is not tenant data. RLS is enabled with NO policy at all, so neither the
-- anon key nor a signed-in session can read or write it through PostgREST; it is
-- reached only by server code using the service-role client, and the write path
-- (/api/admin/studies/settings) is behind isPlatformAdmin().

create table if not exists platform_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

alter table platform_settings enable row level security;
