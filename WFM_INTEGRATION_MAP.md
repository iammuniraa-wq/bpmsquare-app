# WFM Integration Map

> Deliverable required by `BPMSquare_WFM_Requirements.md` §1 — maps every `[MAP]` item to the
> existing BPMSquare structure it must reuse. **Review gate: no schema migration or code until
> this map is approved.** Decisions needing a call from Abdul are marked ⚠️.

Status: v1.0 — inventory complete, awaiting approval.

---

## 1. Tenant / organization model

| WFM requirement | Existing BPMSquare structure |
|---|---|
| Tenant table | `tenants` (uuid `id`) — `supabase/migrations/0000_baseline.sql` |
| Tenant column on every table | `tenant_id uuid not null references tenants(id) on delete cascade` |
| RLS pattern | Enable RLS + one policy in the **same migration** that creates the table (per `MULTI_TENANT_GUARDRAILS.md`). Standard policy: `tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())` |
| Tenant resolution | Per-request from hostname — `requireTenantUser()` in `src/lib/supabase-server.ts:227`. Never from request body. |
| Admin client | `createAdminSupabase()` bypasses RLS — every query on it needs explicit `.eq("tenant_id", tenantId)` |

**WFM deviation (deliberate, stricter than standard):** the standard tenant-isolation policy is
`for all`, meaning any tenant *member* can read/write any tenant row through their own session +
the anon key — fine for CRM objects, **not acceptable for attendance** (acceptance criterion: "no
employee can alter attendance data"). WFM tables get:

- `select` policy: tenant members can read (employee-level narrowing done at API layer, matching
  the codebase convention that role gating lives in API routes, not RLS — see `0052_business_roles.sql`
  header comment).
- **No `insert`/`update`/`delete` policies for session clients.** All writes go through WFM API
  routes using the admin client with explicit tenant + role checks. `presence_events` is
  append-only by construction (no update path exists at all; corrections insert + set
  `superseded_by` via the API).

⚠️ Approve this deviation — it's the only way to honour "employees cannot alter attendance" given
Supabase's client-reachable REST API.

## 2. Auth & roles

Existing: Supabase Auth; `tenant_users (tenant_id, user_id, role)` with `role in ('admin','member')`.
`requireTenantUser()` returns `{ supabase, tenantId, userId, role }`.

Mapping of WFM's three roles:

| WFM role | Maps to |
|---|---|
| `admin` | `tenant_users.role = 'admin'` (existing, unchanged) |
| `supervisor` | `member` whose `wfm_employees` row has `wfm_role = 'supervisor'` (new column on the new employees table, §3) |
| `employee` | `member` whose `wfm_employees` row has `wfm_role = 'employee'` |

- Every WFM employee who punches gets a real auth user + `tenant_users` membership (`member`) and
  a `wfm_employees.user_id` link. Bulk onboarding reuses the existing invite machinery:
  `findOrCreateUserForInvite` (`supabase-server.ts`) / `inviteUserByEmail` pattern already used by
  `api/import/users/route.ts`.
- API-layer checks: employee endpoints resolve `wfm_employees` by `user_id = userId`; supervisor
  endpoints require `role === 'admin' || employee.wfm_role === 'supervisor'`.
- Business Roles (`0052`, feature-flagged): add one `wfm` entry to `WORKCENTERS` in
  `src/lib/workcenters.ts` so tenants using Business Roles can grant/deny the WFM workcenter.
  No other coupling — WFM's employee/supervisor distinction stays on the employee row, because
  Business Roles is demo-gated and grants *workcenter visibility*, not domain semantics.

## 3. Employee / person model — REVISED at build time: extend `employees` (0057)

> Original decision (made against `main`) was a new `wfm_employees` table, because the closest
> thing on main was `technicians` — an FSM resource object, not a people table. At build start
> the work moved to `develop`, which has migration `0057_employees_business_users.sql`: a real
> `employees` master-data table (first/last name, employee_code, department, status) with a
> login link via `tenant_users.employee_id` (Business Users). That is exactly the "existing
> person model" the spec says to EXTEND — so WFM does.

**Decision (final): extend `employees`** (migration 0062) with `employment_type`, `shift_id`,
`site_id`, `wfm_role` (`employee`/`supervisor`), `technician_id` (optional FSM bridge),
`enrolled_photo_path`, `consent_recorded_at`. A login resolves to its employee record through
the existing `tenant_users.employee_id` link — no new user_id column.

Consequence: 0062 also **tightens the `employees` RLS** from 0057's `for all` to
member-read / admin-write — employees now carries fields that feed lateness and consent logic,
and every legitimate mutation path (api/employees, api/business-users, Data Workbench) is
already admin-gated, so nothing breaks.

`technician_leaves` (existing, FSM vacation blocking for dispatch) stays untouched; WFM
`leave_records` is a separate concern (quota/CA accounting). Not merged in v1.

## 4. Storage — ⚠️ new private bucket, not `company-assets`

Existing bucket `company-assets` is **public** (used for logos/case photos via public URLs).
Punch selfies are biometric-adjacent PII under DPDP — they must not be publicly addressable.

**Decision: new private bucket `wfm`**, path `{tenantId}/{employeeId}/{yyyy-mm}/{uuid}.jpg`
(first path segment = tenant id, matching the `(storage.foldername(name))[1]` tenant-isolation
storage RLS pattern established in `0038_storage_tenant_isolation.sql`). Spec's suggested path
`wfm/{tenant}/...` maps to: bucket `wfm`, path `{tenant}/...`.

- Serve via short-lived signed URLs (admin client) from supervisor screens only.
- Upload: async after punch confirmation, client-compressed (~200–400 KB), retry queue.
- Retention job (90-day selfie purge): **no cron infra exists today** (`vercel.json` has no
  `crons`). Add a Vercel cron entry → `POST /api/wfm/cron/retention` guarded by a `CRON_SECRET`
  env check. Same route handles DPDP deletion-request purges.

## 5. Config pattern

Existing pattern: `tenants.features` JSONB → `TenantFeatures` type, and `tenants.config` JSONB →
`TenantConfig` type, both in `src/lib/constants.ts` (types must be updated when shape changes —
CLAUDE.md §8).

- **Module flag:** add `wfm: boolean` to `TenantFeatures` — default **false everywhere**,
  enabled per tenant via `/admin/tenants/[id]` (same rollout convention as
  `0056_new_feature_flags_demo_only.sql`).
- **WFM settings:** add `TenantConfig.wfm` object (spec §7): `late_marks_per_half_day`,
  `carry_forward`, `selfie_retention_days`, `face_verification_mode`, `week_off_pattern`,
  `timezone` (no tenant timezone exists anywhere today — new key, default `Asia/Kolkata`),
  default leave quotas. The spec's `tenant_wfm_config` table maps to this JSONB — no new table.
- **Per-shift values** (`grace_minutes`, `night_allowance_amount`, `is_night_shift`) live on
  `shifts` rows, not config — they vary per shift by nature.
- Gating: `requireFeature("wfm")` in pages (`src/lib/tenant.ts:106`) **and** the feature check in
  every `/api/wfm/**` route (the gating-gap fix in commit `7934751` shows pages-only gating is
  not enough), plus Sidebar filtering.

## 6. UI shell, routing, components

Existing: Next.js App Router; authenticated shell is `src/app/(app)/` (Sidebar +
DashboardLayout, pillar-grouped nav, per-tenant theming via `tenants.config.appearance`).

| WFM surface | Placement |
|---|---|
| Supervisor/admin screens (live board, corrections queue, employees, leave/holidays, config, monthly summary) | `src/app/(app)/wfm/**` inside the standard shell; new sidebar pillar "Workforce", feature-gated |
| Employee PWA (punch, timesheet, corrections, consent) | ⚠️ `src/app/wfm-app/**` — **own lightweight mobile-first layout, no CRM sidebar/shell.** Employees are `member`-role users but should land in the punch screen, not the CRM. Auth reuses the existing Supabase session/login. |
| PWA install | `public/manifest.json` exists (app-wide, CRM-branded). Employee PWA gets its own manifest (`start_url: /wfm-app`) + a service worker for the offline punch queue (**no service worker exists today** — new, scoped to `/wfm-app`). |
| Live board refresh | **Polling** (~30 s). Supabase Realtime is used nowhere in the codebase; don't introduce it for v1. |
| API routes | `src/app/api/wfm/**` — `requireTenantUser()` first line, feature-flag check, admin-client writes per §1 |

## 7. Other mappings (not in the spec's list, but load-bearing)

- **Record identity:** every WFM table gets a DB-generated uuid `id`; mutations key off
  `.eq("id", x).eq("tenant_id", tenantId)` (CLAUDE.md §3). Punch idempotency: client-generated
  event uuid used as the `id` with upsert-on-conflict-do-nothing — satisfies both the idempotency
  requirement and record-identity rules.
- **Bulk employee onboarding (M4):** register `wfm_employees` in the existing Data Workbench
  import registry (`src/lib/import/registrySchema.ts`) instead of building a bespoke Excel
  upload — DW already parses `.xlsx` (`read-excel-file`) and follows the guardrails shape.
- **Excel export (CA summary):** the codebase can *read* xlsx but has **no xlsx writer** (exports
  are CSV). ⚠️ New dependency required — recommend `exceljs` (server-side only, supports the
  styled/merged layouts a CA format will need; template-driven per spec §5.6).
- **Rules engine:** pure functions in `src/lib/wfm/rules.ts` + unit tests. **No test runner is
  configured in the repo today** ⚠️ — adding the rules engine "unit-tested" (M2) means adding
  vitest (or similar) as a dev dependency.
- **Extension architecture:** WFM is **standard product** (multi-tenant, feature-flagged) — no
  code in `src/extensions/`. Any future tenant-specific WFM behaviour goes through the existing
  extension layer.
- **Change history / audit:** `presence_events` is its own audit trail (append-only +
  `superseded_by`); no coupling to the `change_log` feature in v1.
- **Notifications:** in-app only (spec §9.6) — a `notifyEmployee()` interface in `src/lib/wfm/`
  with an in-app implementation; WhatsApp later slots in behind it.

## 8. New tables summary (all: uuid id, tenant_id, RLS per §1)

`wfm_sites`, `wfm_employees`, `wfm_shifts`, `wfm_leave_types`, `wfm_leave_records`,
`wfm_leave_quotas`, `wfm_holidays`, `wfm_correction_requests`, `wfm_presence_events`.
(`wfm_` prefix per spec §1's module-identifier directive; `tenant_wfm_config` is JSONB config,
not a table — §5.)

## 9. Decisions needing approval (recap)

1. **§1** — WFM tables: read-only RLS for session clients, all writes via API/admin client.
2. **§3** — new `wfm_employees` table (with optional `technician_id` link) instead of extending
   `technicians`.
3. **§4** — new **private** `wfm` storage bucket (selfies must not be in the public
   `company-assets` bucket); Vercel cron for retention.
4. **§6** — employee PWA lives at `/wfm-app` with its own minimal layout + manifest + service
   worker, outside the CRM shell.
5. **§7** — two new dependencies: `exceljs` (xlsx export) and a test runner (vitest) for the
   rules engine.
