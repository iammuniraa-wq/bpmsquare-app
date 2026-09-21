# Tenant Provisioning Runbook

> **This file is the single source of truth for provisioning a new client
> tenant.** Whenever tenant provisioning for a new client comes up, follow
> this document 100% — do not improvise the steps from memory. Written
> 2026-08-17 after provisioning BIM Infotech (the first single-module
> tenant), which flushed out every gap in the process; each caveat below
> was learned the hard way that day.

---

## 0. Decisions to settle BEFORE touching the admin panel

- **Shared DB vs dedicated instance.** Default is shared: isolation is RLS
  (enforced by Postgres, not app code) + AES-256-GCM PII encryption +
  per-tenant API keys — the standard SaaS model, same as Salesforce/HubSpot.
  If the client hard-requires a physically separate database, that is a
  **dedicated instance** = same codebase, second Vercel project + its own
  new Supabase project + fresh `FIELD_ENCRYPTION_KEY` + their domain.
  Price it as the Enterprise tier (real recurring cost: every migration
  must be run on their DB too, forever). The full env-var list the app
  needs is in the 2026-08-16 session notes; regenerate with
  `grep -rhoE "process\.env\.[A-Z_]+" src | sort -u`.
- **Module package** (drives the feature flags in step 2):

  | Package | Flags ON (everything else OFF) |
  |---|---|
  | WFM-only | `wfm`, `business_roles`, `administration`, `reports` (recommended), `data_workbench` (needed for bulk employee upload), optionally `change_history` |
  | Full CRM | the form's defaults (core modules pre-ticked) + whatever optional modules were sold |

  ⚠️ The form **pre-ticks all eleven core CRM modules** — for a scoped
  tenant you must untick them one by one. `business_roles` is mandatory
  whenever WFM is on (employee master, Business Users, auto WFM roles).
- **Currency.** Every amount the tenant sees, prints and emails is formatted
  from one setting, `config.currency` (`src/lib/currency.ts`; INR when
  unset). Pick it on the create form; it can be changed later in the
  tenant's Settings → General → Currency or in /admin/tenants/[id]. It
  relabels figures, it never converts them -- so settle it before any data
  is loaded.
- **Provisioning admin email.** Use a plus-alias of the operator's Gmail:
  `<operator>+<slug>@gmail.com`. This creates a genuinely NEW account with
  its own password (mail still lands in the operator's inbox). Do NOT use
  the operator's plain email: an existing account is linked with its
  **existing password — the password field is silently ignored** (by
  design: an invite must never overwrite an existing account's
  credential). Platform admins are also auto-admitted to any tenant host
  (with an admin membership upserted on the fly), so a plain-email login
  "working" proves nothing about the invite.

## 1. Create the tenant

Two ways in, same result -- a studio tenant and a form tenant are
indistinguishable afterwards.

### 1a. Tenant Creation Studio — `/admin/tenant-studio` (preferred)

Describe the client in plain words and the studio drafts the whole plan:
identity, the module scoping, Business Roles with their workcenter grants,
nav visibility, and any users or employees you asked for. Keep typing to
change it ("make it workforce only", "add a Site Supervisor who can edit
rosters", "hide Analytics"), then press **Create tenant**.

Added 2026-09-21. It exists because this runbook's own step 1 is a form
with eleven pre-ticked modules that a scoped tenant has to untick one by
one -- the single most error-prone moment in the process -- and because
steps 1, 4 and the nav/role half of 3 were four separate screens.

What it does NOT change:
- **The three steps in §2 are still yours.** Vercel domain, DNS CNAME and
  the Supabase redirect allowlist cannot be done from inside the app; the
  studio prints them as a checklist with the values filled in, before and
  after creating, and the tenant is unreachable until they are done.
- **Nothing is created until you press the button.** The model drafts; you
  read; the server writes. Every module, workcenter, nav href and currency
  it proposes is intersected with this codebase's real catalogs
  (`normalisePlan()`, `src/lib/admin/tenantStudio.ts`) and anything
  unrecognised is dropped and listed as a warning -- read those warnings,
  they are the difference between a scoped tenant and a quietly wrong one.
- **Experimental flags are never set from a description.**
  `next_experience`, `enterprise_theme` and `spectacular_theme` stay
  hand-set in `/admin/tenants/[id]` (bpmsquarecore.md §10 rule 1).
- **Initial passwords are shown exactly once**, in the result, and stored
  nowhere. Accounts that already existed keep their own password and are
  not listed -- an invite never overwrites an existing credential (see the
  plus-alias note in §0).
- **It is not a transaction.** PostgREST has no cross-statement
  transaction, so the tenant is created first and alone; if a later user or
  role fails, the response says which, and the tenant is live and
  finishable by hand. Nothing is half-created silently.

### 1b. The form — `/admin/tenants/new`

Name, slug (short, lowercase, permanent), **custom domain (required** — the
address users sign in at, e.g. `<slug>.bpmsquare.com`), accent colour, currency, plan,
admin alias email + initial password, feature flags per the package table.
Real client tenants are created ONLY through 1a or 1b — never via SQL
(SQL-managed tenants are a dev-tenant-only convention).

## 2. Domain — Vercel + DNS (the tenant is unreachable until this is done)

The app resolves tenants **by hostname**; a fresh subdomain returns
`DNS_PROBE_FINISHED_NXDOMAIN` until wired (there is no `*.bpmsquare.com`
wildcard — Vercel only allows wildcards when nameservers move to Vercel,
not done because DNS/MX live at the registrar):

1. Vercel → project **bpmsquare-app** (team veveycrm) → Settings → Domains
   → **Add Existing** → `<slug>.bpmsquare.com`.
2. At the DNS provider for bpmsquare.com, clone the existing `vikas` CNAME:
   name `<slug>`, target `cname.vercel-dns.com`.
3. Wait for the row to show **Valid Configuration**. While it still says
   "Generating SSL Certificate" the site loads over plain HTTP —
   **do not log in yet** (session cookies are secure-only in production;
   the login won't stick and the password would travel unencrypted).
4. **Supabase Auth redirect allowlist** — Supabase → Authentication → URL
   Configuration → Redirect URLs must cover the new host (add
   `https://<slug>.bpmsquare.com/**`, or the one-time wildcard
   `https://*.bpmsquare.com/**` that covers all future tenants). Without
   it, forgot-password email links bounce to the project Site URL — the
   WRONG tenant's domain, where the user has no membership — which
   presents as "password reset loops". The app code builds the link from
   the tenant's own origin; the allowlist is what lets Supabase honour it.

## 3. First login + scoping verification

Log in at the tenant domain with the alias + initial password (forced
password change on first login — no email-confirmation links anywhere in
this product). Then verify the tenant is scoped clean:

- **Nav** shows only the bought modules (WFM-only: Dashboard, Master data →
  Employees, Workforce group, Analytics, Data Workbench, Administrator,
  Settings).
- **Settings hub** has no cards for absent modules; Number Ranges lists
  only the tenant's object ranges; General settings has no ghost nav
  toggles or Quote types section.
- **Dashboard** starts (near-)empty for a scoped tenant — that is correct:
  the default layout was CRM. Use **⚙ Adapt dashboard → "+ <module>"
  bundle** to install the module's widgets as the tenant default
  ("My dashboard" is personal; "Adapt" is tenant-wide).
- **Global search** placeholder + dropdown show only the tenant's objects.

If ANY foreign-module surface is visible, it is a bug of the known class
"surface predates the 0067 per-module flags and never opted into checking
them" — fix it with a feature gate in the standard file (see commits
`f91a31e`, `a83538c`, `60cd8ab`, and the Settings-hub `featureAnyOf`
pattern in `3433239`) rather than working around it per tenant.

## 4. People

- **Workspace admins** (no employee record): Settings → Team → invite with
  role Admin. Existing platform accounts are linked directly (password
  ignored, they keep their own).
- **Employees + logins** (few): Workforce → Employees → Add employee
  (EMP-#### auto-assigns; codes are system-generated and immutable —
  never typed). Set **WFM role** (supervisor/employee) and, on employees,
  the **Supervisor** field — that mapping is what routes corrections/
  leave/OT requests to the right queue. Then invite the login from the
  employee row: email + admin-chosen initial password; the matching
  "WFM Supervisor"/"WFM Employee" Business Role attaches automatically.
- **Employees + logins (bulk, e.g. 100):** Data Workbench →
  1. Import **Employees** sheet (no code column — EMP block auto-assigns),
  2. **Export** Employees to obtain the assigned codes,
  3. Import **Users** sheet (email + employee code + role name) — creates
     all logins; **temporary passwords are generated per user and returned
     in the import report** (never put passwords in a spreadsheet). Save
     that report for distribution.
  4. Bulk-assign shifts/sites via the Roster matrix.

## 5. Module configuration

Owned by the client admin (with QA support) — for WFM: Settings →
Workforce in order: timezone → employment types → punch types + OT rate →
punch sites with geofence → shifts → leave types & quotas → holidays →
notification rules. Punching only works once at least one site and one
shift exist and are assigned.

## 6. Handover

When the client names their own admin: Settings → Team → add them as
Admin, then remove the provisioning alias **and** any plain-email
membership the platform-admin auto-admit created during setup. Platform
admins can always re-enter through the admin backdoor if support is needed.

---

*Keep this file current: when provisioning surfaces a new gap or the flow
changes (e.g. a wildcard domain, dedicated-instance tooling), update the
runbook in the same piece of work. The provisioning wizard this note used to
anticipate arrived on 2026-09-21 as the Tenant Creation Studio (§1a) -- it
automates steps 1, 4 and the role/nav half of 3, and deliberately automates
none of §2.*
