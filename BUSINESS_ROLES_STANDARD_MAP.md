# Standard Business Roles + Bulk User Onboarding

> **Review gate: no migration or code until this is approved.** Decisions
> needing a call from Abdul are marked ⚠️.
>
> Status: v1.0 — proposal, awaiting approval.

Goal (client request, 2026-08-06): categorise the BPMSquare suite into
**Sales / Service / Marketing / WFM**, ship a **standard User and Admin role
per category**, let a client admin **add users in bulk (Excel) or manually**
and **assign one or more standard roles**, and let them **copy a standard
role and adapt it** to their own needs.

---

## 1. What already exists (verified, not assumed)

| Piece | Where | State |
|---|---|---|
| `business_roles` / `business_role_grants` / `business_user_roles` | `0052_business_roles.sql` | Complete. Grants are **opt-in per workcenter**; a role grants nothing it has no grant row for. |
| Permission resolution | `src/lib/permissions.ts:41` | `admin` always unrestricted; a member with **zero** roles is also unrestricted; assigned roles are a **union** (most permissive wins). |
| Roles editor UI | `app/(app)/administration/business-roles/BusinessRolesClient.tsx` | List + full-page editor with a 25-row workcenter matrix (View/Create/Edit/Delete + data scope). |
| Users UI | `app/(app)/administration/business-users/BusinessUsersClient.tsx` | Employee-first. Multi-role assignment already works, via `PUT /api/settings/team/[id]/roles`. |
| Bulk user import | `app/api/import/users/route.ts` + `lib/import/usersSchema.ts` | **Already exists** in Data Workbench. 3 columns only (`name`, `email`, `role`), invites by email, builds its own paginated auth index. Does **not** assign business roles. |
| Auto-created roles | `api/wfm/employees/[id]/route.ts:18` | The only place: find-or-create `"WFM Supervisor"` / `"WFM Employee"` by name. |

**Columns on `business_roles` today:** `id, tenant_id, name, description,
created_at, updated_at` + `unique (tenant_id, name)`. No template/standard
provenance column exists — that is the one schema gap.

---

## 2. Core decision: catalog in code, not seeded rows ⚠️

Two ways to ship "standard roles":

**(a) Seed 8 rows per tenant in a migration.** Rejected. Every new tenant
needs a backfill, and the moment we add a workcenter (we added `wfm` this
month) all 8 roles across every tenant are stale with no safe way to update
them — a customer may have edited them by then.

**(b) A code catalog, provisioned per tenant on demand.** Proposed.
`src/lib/standardRoles.ts` holds the 8 definitions; they are materialised
into real `business_roles` rows for a tenant the first time that tenant's
Roles page loads (found-or-created by `template_key`, the same proven shape
as `ensureDefaultWfmRoleAssigned`). New tenants get the current catalog
automatically; no per-tenant migration ever.

### Standard roles are locked; "adapt" means duplicate ⚠️

A standard role renders **read-only** with a **Duplicate** button that
creates a normal, fully-editable role (`"Sales User (copy)"`,
`is_standard = false`).

The reason is upgradeability, not paternalism: if standard roles were
directly editable, then re-syncing the catalog after we add a workcenter
would silently overwrite a customer's changes — and *not* re-syncing leaves
them permanently stale. Locking the originals means the catalog can always
be re-synced safely, and a customer's adaptations are their own rows that we
never touch. This is exactly the requested "copy standard role and adapt".

---

## 3. The catalog

Two levels per category:
- **User** — view/create/edit on their own category; **view-only** on the
  shared context objects they need (accounts, contacts); **no delete**.
- **Admin** — the User grants plus delete, the category's master data, and
  Analytics.

`dashboard` is granted to all 8 (otherwise the landing page 403s).
`administration`, `data_workbench` are in **no** standard role — they are
tenant-wide superuser surfaces and `role = "admin"` already bypasses all of
this. ⚠️ Confirm that's the intent.

| Workcenter | Sales User | Sales Admin | Service User | Service Admin | Marketing User | Marketing Admin | WFM User | WFM Admin |
|---|---|---|---|---|---|---|---|---|
| dashboard | V | V | V | V | V | V | V | V |
| accounts | VCE | VCED | V | VCE | V | VCE | – | – |
| contacts | VCE | VCED | V | VCE | VCE | VCED | – | – |
| quotations | VCE | VCED | – | V | – | – | – | – |
| standard_quotes | VCE | VCED | – | – | – | – | – | – |
| pipeline | V | V | – | – | – | V | – | – |
| invoices | V | VCED | – | VCE | – | – | – | – |
| cases | – | V | VCE | VCED | – | – | – | – |
| amc | – | – | V | VCED | – | – | – | – |
| work_orders | – | – | VCE | VCED | – | – | – | – |
| dispatch | – | – | VCE | VCED | – | – | – | – |
| technicians | – | – | V | VCED | – | – | – | – |
| assets | – | V | VCE | VCED | – | – | – | – |
| suppliers | – | – | V | VCED | – | – | – | – |
| inventory | – | – | V | VCED | – | – | – | – |
| purchase_orders | – | – | – | VCED | – | – | – | – |
| marketing | – | – | – | – | VCE | VCED | – | – |
| marketing_segments | – | – | – | – | VCE | VCED | – | – |
| leads | V | VCE | – | – | VCE | VCED | – | – |
| partners | – | V | – | – | VCE | VCED | – | – |
| employees | – | – | – | V | – | – | – | VCED |
| wfm | – | – | – | V | – | – | V | VCED |
| reports | – | V | – | V | – | V | – | V |

`V`=view `C`=create `E`=edit `D`=delete `–`=no grant

> **WFM caveat:** the `wfm` workcenter grant only opens *My Workforce*. The
> five supervisor screens are gated separately by `employees.wfm_role`
> (`requireWfmSupervisorPage`). So "WFM Admin" also needs that employee
> record set to `supervisor` — the role alone is not enough. This is by
> design (an employee's supervisor status is an HR fact, not a CRM
> permission) and will be stated in the UI.

---

## 4. Schema change

`0065_standard_business_roles.sql` — additive only:

```sql
alter table business_roles add column template_key text;
alter table business_roles add column is_standard boolean not null default false;
create unique index business_roles_template_idx
  on business_roles (tenant_id, template_key) where template_key is not null;
```

Existing rows are untouched (`is_standard = false`, `template_key = null`)
— every custom role a tenant already has keeps working exactly as-is.

---

## 5. Bulk user onboarding

**Extend the import that already exists** rather than building a parallel
one. `usersSchema.ts` grows from 3 columns to 5:

| Column | Required | Notes |
|---|---|---|
| `name` | yes | |
| `email` | yes | |
| `role` | yes | `admin` \| `member` (the existing tenant tier) |
| `business_roles` | no | `;`-separated role **names**, e.g. `Sales User;Marketing User`. Resolved per tenant; an unknown name fails that row with a clear message rather than silently granting nothing. |
| `employee_code` | no | Links the login to an existing employee (enables WFM/punch for that person). |

Manual add is unchanged — Settings → Team and Administration → Business
Users both already assign multiple roles.

### Decided 2026-08-06 (client)

**No invite emails for client-admin-added users.** An invite email is sent
only once, when the *client itself* is onboarded (the first login). Every
user a client admin adds afterwards — manually or by import — is created
directly, with `email_confirm: true` and no email sent. This also removes
the Supabase rate-limit problem entirely, since bulk import now sends zero
emails.

That leaves one question the client's answer implies but doesn't state: how
the new user learns their password. **Decision: the importer generates a
strong temporary password per row and returns it in the import result for
the admin to hand out.** No `password` column in the sheet — a spreadsheet
of plaintext passwords gets forwarded and archived, which is a real
security problem, not a theoretical one. An admin who wants to set a
specific password can still do it per-user in Administration → Business
Users, exactly as today.

> **Follow-up worth doing later, not in this pass:** Supabase has no native
> "must change password at next login" flag. Until one is added (a boolean
> on `tenant_users` checked in middleware), a temporary password stays
> valid until the user changes it voluntarily. Tracked, not built.

**`administration` and `data_workbench` stay out of every standard role** —
confirmed. They are admin-only surfaces; `role = "admin"` already bypasses
role checks entirely.

**Scale.** `GET /api/business-users` calls `auth.admin.getUserById` once per
row. Being fixed in this pass (one paginated `listUsers` into a map)
since bulk import makes large tenants realistic.

---

## 6. Build order

1. `0065` migration (template_key, is_standard).
2. `src/lib/standardRoles.ts` — the catalog + `provisionStandardRoles()`.
3. Provision on Roles-page load; render standard roles read-only with a
   **Duplicate** action; block PATCH/DELETE of `is_standard` rows API-side
   (not just in the UI).
4. Extend `usersSchema.ts` + `api/import/users` for `business_roles` and
   `employee_code`.
5. Docs + a manual test script, once it's confirmed working.

Nothing here is feature-flagged to demo-only — it's core product — but the
existing `business_roles` feature flag still gates the whole surface, so
tenants without it see no change at all.
