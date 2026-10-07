# KAN-29 — per-employee remote punch flag

Client requirement (BIM, 2026-10-07): **every employee punches at the office
kiosk. By exception, an admin activates remote working for a named person, and
only then can that person punch from their phone.**

Owner decision the same day: a **permanent flag maintained by the admin**, not
an expiring one. An optional end date was considered and deferred as more work
than it is currently worth; if the flag is found drifting in practice (someone
enabled for a two-week posting still enabled in March), revisit it then.

---

## What already exists — do not rebuild it

Most of this requirement is shipped and working. The only thing missing is that
the existing switch is **tenant-wide** rather than per-employee.

| Piece | Where | State |
|---|---|---|
| Tenant-wide kiosk-only switch | `TenantConfig.wfm.employee_self_service` (`lib/constants.ts`) | Works |
| Settings UI for it | `settings/workforce/WorkforceConfigClient.tsx` ~line 212 | Works |
| **Server-side enforcement** | `api/wfm/punch/route.ts:114` — returns 403 | Works |
| Punch screen branch | `MeClient.tsx:1280` — shows the "use the kiosk" message | Works |
| Kiosk punch route | `api/wfm/kiosk/punch/route.ts` — separate endpoint | Unaffected, leave alone |
| Offline replay safety | idempotency short-circuit above the gate | Works, leave alone |

The 403 at `punch/route.ts:114` is the real gate — its own comment says *"a
saved bookmark or a direct POST can't punch from a phone either."* **Keep that
property.** Everything below extends that gate; nothing below weakens it.

---

## The change

One new per-employee override, consulted before the tenant default.

### Resolution rule

```
effective_self_service =
    employee.self_service_override   ?? config.employee_self_service
```

- `null`  → follow the workspace setting (the default for everyone)
- `true`  → this person may punch from their phone, whatever the workspace says
- `false` → this person may not, whatever the workspace says

Three states, not a boolean, so that "allow remotely" and "explicitly deny this
one person" are both expressible and neither is confused with "not set".

---

## Work items

### 1. Migration — `supabase/migrations/0126_wfm_employee_self_service_override.sql`

```sql
alter table employees
  add column self_service_override boolean;

comment on column employees.self_service_override is
  'KAN-29. NULL = follow tenants.config.wfm.employee_self_service. true/false
   overrides it for this employee. Permanent until an admin changes it.';
```

Nullable, no default — `null` must mean "inherit", and a default would make
every existing row an explicit decision nobody made.

**Add it to PROJECT.md''s operational ledger as pending on both databases.**
Nothing auto-applies migrations here; the owner runs them by hand. Until it is
applied, `self_service_override` will not exist — so **the code must tolerate a
missing column**: treat an undefined value exactly as `null` (inherit). Do not
let a `42703` (undefined column) break punching.

### 2. Type — `src/lib/types.ts`

Add to the `Employee` type, beside `wfm_role` (~line 383):

```ts
/** KAN-29. null = follow the workspace setting. */
self_service_override: boolean | null;
```

### 3. The gate — `src/app/api/wfm/punch/route.ts` (~line 114)

This is the security-critical edit. The existing block is:

```ts
if (!config.employee_self_service) {
  return NextResponse.json({ error: "Punching from your phone is turned off — ..." }, { status: 403 });
}
```

Replace the condition with the resolution rule, reading the override from the
`employee` already loaded by `requireWfmEmployee()` (do not add a query if it is
already in scope — check first; if it is not selected there, add the column to
that select rather than issuing a second round trip).

Keep the 403, keep the message for the inherited/false case. The comment above
it must stay and be extended — it documents why this is the real gate.

### 4. Effective value to the client — `src/lib/wfm/meState.ts` (~line 219)

`employee_self_service: config.employee_self_service` currently passes the raw
tenant value. Pass the **resolved** value instead, so the punch screen shows the
right thing for that person. `MeClient` needs no change — it already branches on
this field.

### 5. Admin control — employee PATCH route

`src/app/api/wfm/employees/[id]/route.ts`, in the explicit allowlist (~line 111,
beside `wfm_role`):

```ts
if (body.self_service_override === null || typeof body.self_service_override === "boolean") {
  patch.self_service_override = body.self_service_override;
}
```

Note `null` must be accepted explicitly — `typeof null === "object"`, so a plain
`typeof === "boolean"` check silently drops "reset to inherit".

**Admin only.** `wfm_role: supervisor` must NOT be able to grant this; a
supervisor granting their own team remote punching defeats the control. Check
how the route distinguishes admin from supervisor and follow it; if it does not
currently distinguish, gate on `role === "admin"` from `requireTenantUser()`.

**Change-log it.** The route already uses `diffForLog`/`logChange` — make sure
this field is included. "Who gave this person remote access, and when" is the
question that gets asked after an incident, not before.

### 6. Admin UI — `src/app/(app)/wfm/employees/WfmEmployeesClient.tsx`

A three-way control beside the existing `wfm_role` select (~line 275):

```
Punching:  [ Workspace default ▾ ]   // null
           [ Allow from phone    ]   // true
           [ Kiosk only          ]   // false
```

Label it in the employee's language, not the field's. The current workspace
default should be visible next to it (e.g. "Workspace default — kiosk only"), or
an admin cannot tell what "default" currently means.

### 7. The list — same file

Employees with an explicit override are the exception, so make them findable: a
small badge on the row, and ideally a filter. An admin needs to answer "who has
remote access right now?" without opening 96 records.

---

## Out of scope — do not build

- **No expiry / end date.** Deferred by the owner today.
- **No per-day approval flow.** The advance-request machinery (`wfh`, see
  `lib/wfm/advanceRequests.ts`) stays exactly as it is and is not touched.
- **No change to the kiosk route.** It is a separate endpoint with its own auth
  and must keep working regardless of this flag.
- **No change to the offline queue or the idempotency short-circuit.**

---

## Verification before commit

- `npx tsc --noEmit` and `npx next build` both clean.
- `npx vitest run` — currently 504 passing; do not regress it.
- **Degrades cleanly with the migration unapplied** — this is the one that will
  actually bite. Confirm punching still works when the column does not exist.
- Manually reason through all six combinations of
  `{workspace on, workspace off} × {override null, true, false}` and state the
  expected outcome for each in the commit message.
- The 403 still fires for a direct `POST /api/wfm/punch` by an employee who is
  kiosk-only. The UI hiding the button is not the test.

## Commit message must report

The checklist above including any deliberate skip, and **the exact SQL file the
owner must run by hand**.
