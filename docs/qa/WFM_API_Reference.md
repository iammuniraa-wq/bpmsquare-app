# BPMSquare — Workforce Management (WFM) API Reference

**Audience:** QA, for functional, boundary and stress testing.
**Companion files:** `BPMSquare_WFM.postman_collection.json`, `BPMSquare_WFM.postman_environment.json` (94 requests, 13 folders).
**Status:** matches `main` as of 2026-08-12, including the overtime / punch-type release.

---

## 1. How authentication works

WFM endpoints are **session-cookie authenticated**, not bearer-token authenticated. There is no
API key for this module. (The `/api/v1/**` family has per-tenant bearer keys; WFM is not part of it.)

To authenticate from Postman, curl, k6 or anything else, do two calls:

**Step 1 — get Supabase tokens**

```http
POST https://<project>.supabase.co/auth/v1/token?grant_type=password
apikey: <supabase anon key>
Content-Type: application/json

{ "email": "user@example.com", "password": "..." }
```

Returns `access_token` and `refresh_token`.

**Step 2 — exchange them for app session cookies**

```http
POST {{baseUrl}}/api/auth/session
Content-Type: application/json

{ "access_token": "...", "refresh_token": "..." }
```

The response sets the `sb-*` cookies. Every subsequent WFM call authenticates from those cookies.
In Postman the cookie jar handles this automatically; in k6/curl, capture and resend the `Set-Cookie`
values.

> ### ⚠ Tenant is resolved from the HOSTNAME
> There is no tenant header, no tenant body field, and no tenant switch anywhere in the product.
> `resolveHostTenant()` derives the tenant from the request host on every single request. To test a
> different tenant you point `baseUrl` at that tenant's host.
>
> **If you ever find an endpoint that accepts a tenant identifier from the client, stop and report it
> as a security defect** — that would be a critical finding, not a feature.

---

## 2. The three personas

Almost every test case in this module is really a question of *who is calling*. The UI hides actions
a persona can't perform, so the API is the real boundary and must be tested directly.

| Persona | How it's defined | Can do |
|---|---|---|
| **Employee** | `employees.wfm_role = 'employee'`, linked to a login via `tenant_users.employee_id` | Punch, see **only their own** timesheet/analytics/presence, file corrections and leave, respond to rechecks |
| **Supervisor** | `employees.wfm_role = 'supervisor'` **or** tenant admin **or** granted via a Business Role | All of the above, plus the live board, **any** employee's presence, the whole-tenant monthly summary, and **approval** of OT / corrections / leave |
| **Tenant admin** | `tenant_users.role = 'admin'` | All of the above, plus configuration: shifts, sites, holidays, leave types, Settings → Workforce |

Two boundaries worth testing explicitly because they're easy to get wrong:

- A **supervisor who is not an admin** gets `403` on every config write (shifts, sites, holidays, leave
  types). Supervisors run the queues; admins own the configuration.
- An **employee cannot approve anything**, including their own request. Approval endpoints call
  `requireWfmSupervisor()` before touching the database.

---

## 3. The punch state machine

Everything in attendance derives from this. The server validates every punch against the employee's
current state — derived from their most recent non-superseded event — and rejects illegal transitions
with `409`.

```
  out  ──check_in / mobile_work_start / business_trip_start──▶  in
  out  ──ot_in──▶  ot
  in   ──break_start──▶  break        break ──break_end──▶  in
  in   ──check_out / mobile_work_end / business_trip_end──▶  out
  break──check_out / mobile_work_end / business_trip_end──▶  out
  ot   ──ot_out──▶  out
```

**The rule this encodes:** overtime is reachable **only** from `out`. There is no transition from `in`
or `break` into `ot` at all. That is the structural implementation of the client's requirement —
*"OT can happen anytime, but not between check-in and check-out"* — so an employee must genuinely check
out of their regular shift before punching OT in. It cannot be bypassed by calling the API directly,
because the transition simply does not exist in the table.

**The ten punch kinds:**

| Kind | Group | Notes |
|---|---|---|
| `check_in`, `check_out` | core (always on) | |
| `break_start`, `break_end` | core (always on) | |
| `ot_in`, `ot_out` | `ot` | `ot_out` creates the payable OT session |
| `mobile_work_start`, `mobile_work_end` | `mobile_work` | Ordinary working time under a different label — the hours engine treats it exactly like check-in/out |
| `business_trip_start`, `business_trip_end` | `business_trip` | Same |

The three optional groups are per-tenant switches (Settings → Workforce → punch types). A punch of a
disabled kind returns `403` **server-side**, not just a hidden dropdown option.

---

## 4. Endpoint index

`{{baseUrl}}` prefixes every path. **Role** = minimum persona required.

### Punch & self-service

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/wfm/consent` | Employee | Record DPDP consent. Punching is `403` until this exists |
| POST | `/api/wfm/punch` | Employee | Record one presence event |
| POST | `/api/wfm/punch/selfie` | Employee | Attach a selfie (multipart) to an already-recorded punch |
| GET | `/api/wfm/me/state` | Any WFM user | Punch-screen bootstrap |
| GET | `/api/wfm/me/timesheet?month=` | Employee | Own month: days, totals, OT, leave balance |
| GET | `/api/wfm/me/analytics?month=` | Employee | Own 6-month trend (+ team averages **only** if supervisor) |
| GET / PATCH | `/api/wfm/me/landing-preference` | Any WFM user | Own default landing page |

### Approval workflows

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/wfm/ot-sessions?status=&employee_id=` | Any WFM user | Supervisor: whole queue. Employee: own only |
| PATCH | `/api/wfm/ot-sessions/{id}` | **Supervisor** | Approve / reject overtime — **the pay gate** |
| GET | `/api/wfm/corrections?status=&employee_id=` | Any WFM user | Same scoping rule |
| POST | `/api/wfm/corrections` | Employee | File a correction |
| PATCH | `/api/wfm/corrections/{id}` | **Supervisor** | Approve / reject |
| GET | `/api/wfm/leave-requests?status=&employee_id=` | Any WFM user | Same scoping rule |
| POST | `/api/wfm/leave-requests` | Employee | Apply for leave |
| PATCH | `/api/wfm/leave-requests/{id}` | **Supervisor** | Approve / reject |
| GET | `/api/wfm/recheck-requests?status=` | Any WFM user | Same scoping rule |
| POST | `/api/wfm/recheck-requests` | **Supervisor** | Flag a punch or a day |
| PATCH | `/api/wfm/recheck-requests/{id}` | Both | `respond` = flagged employee only; `resolve`/`dismiss` = supervisor only |

### Supervisor views

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/wfm/live-board` | **Supervisor** | Today's attendance, all employees |
| GET | `/api/wfm/presence?employee_id=&date=` | Own always / **Supervisor** for others | Punch audit with signed selfie URLs + geo |
| GET | `/api/wfm/summary?month=` | **Supervisor** | Whole-tenant monthly aggregate incl. OT |
| GET | `/api/wfm/summary/export?month=` | **Supervisor** | Excel, one sheet per employment type |
| GET | `/api/wfm/geocode?address=` | **Supervisor** | Address → lat/lng for the site picker |

### Master data & roster

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET / POST | `/api/wfm/employees` | **Supervisor** | List / create |
| GET / PATCH | `/api/wfm/employees/{id}` | **Supervisor** | Hub profile / edit + provision a login |
| PATCH | `/api/wfm/employees/bulk-shift` | **Supervisor** | Standing shift for ≤500 employees |
| PATCH | `/api/wfm/employees/bulk-site` | **Supervisor** | Home site for ≤500 employees |
| GET / POST | `/api/wfm/roster` | Any WFM user / **Supervisor** | Date-range read / bulk assign |
| DELETE | `/api/wfm/roster/{id}` | **Supervisor** | Clear one override |
| GET / POST | `/api/wfm/leave-records` | **Supervisor** | The approved-leave ledger / direct entry |
| DELETE | `/api/wfm/leave-records/{id}` | **Supervisor** | |

### Configuration — **admin only** for every write

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET / POST | `/api/wfm/shifts` | Supervisor / **Admin** | |
| PATCH | `/api/wfm/shifts/{id}` | **Admin** | |
| GET / POST | `/api/wfm/sites` | Supervisor / **Admin** | |
| PATCH | `/api/wfm/sites/{id}` | **Admin** | |
| GET / POST | `/api/wfm/holidays?year=` | Any WFM user / **Admin** | |
| DELETE | `/api/wfm/holidays/{id}` | **Admin** | |
| GET / POST | `/api/wfm/leave-types` | Supervisor / **Admin** | |
| PATCH | `/api/wfm/leave-types/{id}` | **Admin** | |
| GET / PUT | `/api/settings/workforce` | Any member / **Admin** | Tenant WFM config |

### Platform

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/wfm/cron/retention` | `Authorization: Bearer <CRON_SECRET>` | Daily selfie purge across all tenants |

---

## 5. Key payloads

### POST `/api/wfm/punch`

```json
{
  "id": "3f2b6c10-8d4e-4a91-9c77-1b2a3c4d5e6f",
  "kind": "check_in",
  "ts": "2026-08-12T09:03:11.000Z",
  "geo": { "lat": 17.4435, "lng": 78.3772, "accuracy_m": 12 }
}
```

| Field | Required | Rules |
|---|---|---|
| `id` | **yes** | Client-generated UUID. Re-sending the same id is an **idempotent no-op** returning `{ok:true, duplicate:true}` — this is how the offline queue retries safely |
| `kind` | **yes** | One of the ten kinds. Must be legal from the current state, else `409` |
| `ts` | no | Defaults to now. Accepted window: **7 days past, 5 minutes future**. Must also be strictly later than the previous punch, else `409` |
| `geo` | no | Behaviour depends on `geofence_mode`: `block` rejects an out-of-fence punch with `409`, `flag` records `within_geofence:false`, `off` skips the check entirely |

Success:

```json
{
  "ok": true,
  "event": { "id": "...", "kind": "check_in", "ts": "...", "site_id": "...", "within_geofence": true },
  "state": "in",
  "site_name": "Hyderabad Plant",
  "within_geofence": true,
  "running_minutes": 0,
  "break_minutes": 0
}
```

**On `ot_out`** the server additionally finds the matching open `ot_in`, computes the duration
**server-side from the two stored event timestamps**, and inserts a `wfm_ot_sessions` row with
`status: 'pending'`. The client never supplies a duration.

### POST `/api/wfm/corrections`

```json
{
  "target_date": "2026-08-12",
  "issue": "missing_check_out",
  "proposed_ts": "2026-08-12T18:05:00.000Z",
  "target_event_id": null,
  "reason_text": "Phone battery died before I could punch out",
  "recheck_request_id": null
}
```

`issue` ∈ `missing_check_in` | `missing_check_out` | `wrong_time` | `other`.
`proposed_ts` is required for the two `missing_*` issues. `target_event_id`, when given, is verified
to belong to **the caller** — someone else's event id returns `400`.

### POST `/api/wfm/leave-requests`

```json
{
  "leave_type_id": "…uuid…",
  "date_from": "2026-09-14",
  "date_to": "2026-09-16",
  "half_day": false,
  "reason_text": "Family function"
}
```

`leave_type_id` must be an **active** type in this tenant. `date_to < date_from` is `400`.
`half_day` is only meaningful when the two dates are equal.

### PATCH — every approval endpoint shares one shape

```json
{ "action": "approve", "supervisor_remark": "Verified against the production log" }
```

`action` ∈ `approve` | `reject`. **`supervisor_remark` is mandatory on reject** (`400` without it) and
optional on approve. Re-resolving an already-resolved item returns `409` — no double approval.

### POST `/api/wfm/roster`

```json
{
  "employee_ids": ["…uuid…"],
  "dates": ["2026-09-01", "2026-09-02"],
  "shift_id": "…uuid…",
  "site_id": null,
  "is_day_off": false,
  "note": "Festival coverage"
}
```

Server-side caps: **500** employees, **62** dates, **3000** employee×date combinations per call.
`shift_id` is required unless `is_day_off` is true. If *any* employee id doesn't resolve inside the
tenant, the **entire call** `400`s — deliberately loud rather than a silent partial apply.

### PUT `/api/settings/workforce`

```json
{
  "timezone": "Asia/Kolkata",
  "deduct_breaks": true,
  "late_marks_per_half_day": 3,
  "leave_carry_forward": false,
  "selfie_retention_days": 90,
  "face_verification_mode": "flag_only",
  "week_off_days": [0],
  "geofence_mode": "flag",
  "ot_rate_per_hour": 150,
  "punch_types": { "ot": true, "mobile_work": false, "business_trip": false },
  "employment_types": [
    { "code": "full_time", "label": "Full Time" },
    { "code": "contractor", "label": "Contractor" },
    { "code": "intern", "label": "Intern" }
  ],
  "notifications": {
    "late_arrival": true, "correction_pending": true,
    "leave_pending": true, "recheck_flagged": true
  }
}
```

> **Behaviour QA must be aware of:** this is a **partial merge that silently ignores anything invalid**
> rather than returning `400`. Always `GET` after `PUT` to confirm what actually landed — a rejected
> field looks identical to a field you forgot to send.

Validation worth probing: employment-type `code` must match `^[a-z0-9_]{1,40}$`; the list can never be
saved empty; duplicate codes are collapsed; `geofence_mode` ∈ `block|flag|off`; `ot_rate_per_hour` must
be a finite number ≥ 0.

**Do not rename an employment-type code that employees already reference** — `employees.employment_type`
stores the code, and the monthly Excel export groups sheets by it. The label is the editable part.

---

## 6. Overtime — how pay is actually derived

Worth understanding before writing OT test cases, because several plausible-looking bugs are actually
correct behaviour:

1. Employee punches `ot_in` (only possible from state `out`).
2. Employee punches `ot_out`. The server finds the last open `ot_in`, computes elapsed minutes **from
   the two stored timestamps**, and writes a `wfm_ot_sessions` row: `status = 'pending'`.
3. `ot_date` is stamped with the shift-day the session **started** on. An OT stretch running past
   midnight therefore stays **one payable block on its start day** rather than splitting across two
   days — this is deliberate, and it is what makes the client's "might be the entire night" case work.
4. A supervisor approves or rejects. **Only `approved` sessions** contribute to `ot_minutes` and
   `ot_amount` in the monthly summary and the Excel export. Pending and rejected OT is visible
   everywhere but counted nowhere.
5. `ot_amount = (approved OT minutes ÷ 60) × ot_rate_per_hour`, on **exact minutes with no rounding**,
   at the tenant's flat rate — both per the client's stated requirement.

Replay safety: a unique index on `end_event_id` means an offline-sync replay of the same `ot_out`
cannot create a second OT session.

---

## 7. Status codes you should expect

| Code | Meaning in WFM |
|---|---|
| `200` | Success. Note `{ok:true, duplicate:true}` is also a `200` — an idempotent replay, not a new event |
| `400` | Validation: bad UUID, unknown kind, `ts` out of range, malformed date/month, unknown foreign id, bulk cap exceeded, missing reject remark |
| `401` | Cron route without the bearer secret |
| `403` | Wrong persona (employee attempting a supervisor action, supervisor attempting an admin action), consent not recorded, punch type disabled for the tenant, WFM feature flag off |
| `404` | Not found — **also** returned instead of `401` on some WFM paths for an unauthenticated caller, deliberately, so the module's existence isn't advertised |
| `409` | State conflict: illegal punch transition, punch predating the previous one, geofence block, already-resolved approval, duplicate employee code, duplicate holiday |
| `500` | Genuine server error — always worth reporting with the request body |

A **cross-tenant id behaves exactly like a nonexistent id** (`400`/`404`), never as a successful
operation on another tenant's row. That's by design and is worth asserting in test cases.

---

## 8. Stress testing

**Read load, in descending cost:**

| Endpoint | Why it's expensive |
|---|---|
| `GET /api/wfm/summary?month=` | Recomputes **every** employee's month from raw events. The heaviest call in the module |
| `GET /api/wfm/summary/export?month=` | Same computation plus xlsx generation. Heaviest response body |
| `GET /api/wfm/live-board` | Polled roughly every 30s per open supervisor screen — the highest *sustained* request rate in normal use |
| `GET /api/wfm/presence` | The **first** call for an employee-day mints signed selfie URLs and lazily reverse-geocodes coordinates; repeats are cached. Measure cold and warm separately or the numbers are meaningless |
| `GET /api/wfm/me/timesheet` | Cheap per call; the interesting case is many employees at once |

**Write load:**

| Endpoint | Shape |
|---|---|
| `POST /api/wfm/punch` | The realistic burst: an entire shift punching in within a few minutes. Each punch does a state read, a config read, an insert, and a running-total recompute |
| `POST /api/wfm/roster` | Up to 3000 upserted rows in a single call |
| `PATCH /api/wfm/employees/bulk-*` | Up to 500 rows per call |

**Concurrency cases worth deliberately racing** — these are where a real defect would live:

- Two punches for the **same employee** submitted simultaneously. State is read and then written, so
  this is the genuine race. Correct: one succeeds, the other `409`s or is absorbed as a duplicate.
  **Two events both landing would be a real finding.**
- The same punch `id` replayed N times in parallel — must yield exactly one event.
- Two supervisors approving the **same** OT session at once — exactly one wins, the other gets `409`.
  Two approvals landing would mean OT could be paid twice.

**Method:** sign in **once** and reuse the cookie across virtual users. Re-authenticating per VU
measures Supabase Auth's project-level rate limits rather than the application.

**There is no application-level rate limiting on these routes.** If a load test saturates the service,
that is a capacity data point, not a bug — please report the numbers (RPS, latency percentiles, error
mix) rather than a pass/fail.

---

## 9. Known gaps to keep in mind while testing

Not defects to re-report — these are already known and tracked:

- **Cache invalidation is global, not tenant-scoped.** One tenant's write invalidates another tenant's
  cache entry. Every recompute is still correctly tenant-scoped, so this is a wasted-cache-hit
  inefficiency, not a data leak.
- **`PUT /api/settings/workforce` silently drops invalid fields** instead of rejecting them (see §5).
- **Overtime billing is not wired into service/field work.** The work-order → invoice labour line
  currently pre-fills from **regular hours only**; whether approved OT should be billed to the customer,
  and at which rate, is an open business decision, not a bug.
