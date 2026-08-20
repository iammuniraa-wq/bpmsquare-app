-- 0092: Face punch (in-app biometric attendance) — schema only.
--
-- A tenant's door tablet runs the app fullscreen as a registered kiosk;
-- an employee's face, matched server-side (AWS Rekognition, ap-south-1,
-- behind our own API — the client only ever talks to bpmsquare.com),
-- identifies them and they tap one of the valid punch buttons. This
-- migration is purely additive: two tables + config plumbing land first,
-- enrollment and the kiosk screen build on top in later steps. Nothing
-- reads these tables yet and the face_punch config key defaults to "off".

-- One row per enrolled employee. provider_face_ids are Rekognition's
-- template ids; photo_paths are OUR OWN copies of the enrollment frames in
-- the private `wfm` bucket ({tenant_id}/face-enroll/{employee_id}/…), kept
-- so the provider is replaceable — re-enrollment from stored photos, no
-- employee ever re-scans (Rekognition templates cannot be exported).
create table if not exists wfm_face_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  provider            text not null default 'aws_rekognition',
  provider_face_ids   text[] not null default '{}',
  photo_paths         text[] not null default '{}',
  consent_recorded_at timestamptz not null,
  enrolled_by         uuid,
  status              text not null default 'active' check (status in ('active', 'revoked')),
  created_at          timestamptz not null default now(),
  unique (tenant_id, employee_id)
);

alter table wfm_face_enrollments enable row level security;

-- WFM convention (0062 header, re-learned the hard way in 0078): tenant
-- SELECT only, NO write policy at all — enrollment is written exclusively
-- by the service-role client through supervisor-gated API routes. An
-- employee must never be able to create, alter, or revoke a biometric
-- enrollment through PostgREST with their own session.
create policy "wfm_face_enrollments: tenant read" on wfm_face_enrollments
  for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- A registered kiosk: one physical tablet, bound to one site. The device
-- authenticates with a bearer token shown once at creation; only its
-- sha-256 lands here (same pattern as scoped API keys). Kiosk punches
-- carry site_id from this row — a wall-mounted tablet needs no GPS.
create table if not exists wfm_kiosk_devices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  site_id      uuid not null references wfm_sites(id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  active       boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table wfm_kiosk_devices enable row level security;

-- NO policies at all, deliberately: the row carries the device credential
-- hash, so PostgREST access is deny-all for every session. Admin screens
-- and the kiosk itself go through API routes on the service-role client.
