# Multi-Tenant Guardrails

> **Always loaded** — imported from `bpmsquarecore.md`, which every session reads
> before writing code. This file exists because of a 2026-07-21 audit that found
> real (if mostly low-severity) gaps in tenant isolation, plus one systemic
> pattern worth naming explicitly: nothing in this codebase lets a user *choose*
> a tenant. Tenant identity is resolved **per request, from the hostname**
> (`resolveHostTenant()` in `src/lib/supabase-server.ts`), and a single user can
> genuinely belong to more than one tenant (platform admins always do). That
> means tenant separation depends entirely on every data-access path getting
> this right, every time — there is no client-side switch to fall back on.

**The one-sentence rule:** if you can't point at the specific RLS policy or the
specific `.eq("tenant_id", tenantId)` that stops a tenant-A request from
touching tenant-B's row, the change isn't done yet.

---

## Before writing any query or mutation

- [ ] Does the route call `requireTenantUser()` (or `isPlatformAdmin()`­ /
      `getAuthUser()` for platform-admin-only routes under `src/app/admin/**`)
      before touching the database?
- [ ] Is `tenantId` used later in the function **exclusively** the one
      destructured from that call? Never read a tenant identifier from
      `request.json()`, `searchParams`, or any client-supplied value — a route
      that lets the client claim a tenant, even for a field you assume is
      harmless, is a critical finding.

## For every Supabase query you add or touch

- **Session client** (`supabase` from `requireTenantUser()`) — RLS is the real
  backstop, but don't assume it exists. Grep `supabase/schema.sql` and
  `supabase/migrations/*.sql` for `enable row level security` + `create
  policy` on the exact table name before trusting it. (`custom_fields` had
  neither for years — see "Known fixed issues" below.)
- **Admin/service-role client** (`createAdminSupabase()`) — **bypasses RLS
  entirely.** Every single query on this client against a tenant-owned table
  needs its own explicit `.eq("tenant_id", tenantId)`. No exceptions, no
  "it's just a read." This is where cross-tenant leaks actually happen in
  this codebase.
- **Any foreign id read from the request body** (`quote_id`, `account_id`,
  `contact_id`, `case_id`, `contract_id`, `supplier_id`, ...) that gets woven
  into an insert or update — verify it resolves to a row with
  `tenant_id = tenantId` *before* using it, with its own
  `.eq("id", x).eq("tenant_id", tenantId).maybeSingle()` check. Don't trust a
  client-supplied id just because it's "only for linking two records." (This
  was the invoices-route gap fixed 2026-07-21 — quote_id/contact_id/case_id/
  contract_id were taken from the body unverified while account_id was
  checked; fixed to check all of them.)

## For any new database table

- [ ] `tenant_id uuid not null references tenants(id)`.
- [ ] `alter table X enable row level security;` **and** a tenant-isolation
      policy, in the *same* migration that creates the table — not a
      follow-up "we'll get to it."
      ```sql
      create policy "X: tenant isolation" on X for all
        using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
        with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
      ```
- [ ] The table is created via a tracked migration in `supabase/migrations/`
      or `supabase/schema.sql` — **never** ad-hoc via the Supabase dashboard
      / SQL editor with no corresponding file. `page_layouts` and
      `deletion_log` are both live, in-use tables with no tracked schema
      anywhere in this repo — their RLS status can't be verified from the
      code, which is exactly the failure mode this rule prevents. If you
      touch either of those tables, write the missing migration first.

## For any caching you add

- `cache()` (React, request-scoped) and `unstable_cache` (Next.js, can
  persist across requests/deployments) are both used in this codebase
  (`src/lib/tenant.ts`, `src/lib/data/live.ts`). If the cached function
  returns tenant-scoped data, `tenantId` must be part of the cache key /
  `unstable_cache` key array — otherwise tenant A's cached result can be
  served to a tenant B request.
- Never store tenant-scoped data in a module-level `let`/mutable
  object/`Map` that isn't re-derived per request. Server code here runs in a
  shared Node process across requests (serverless containers stay warm) —
  an accidental module-level cache is a real leak vector, not a theoretical
  one.

## Data Workbench (`src/app/api/{import,export,update}/**`) specifically

Newest, highest-blast-radius surface in the app (bulk read/write across
every object). Every route in this family follows one proven shape — match
it exactly for any new object:
- `requireTenantUser()` first, always.
- Every lookup/reference map built via `fetchAllRows(supabase, table, cols,
  tenantId)` (`src/lib/import/server.ts`) — never a raw `.select()` without
  the tenant filter.
- Every inserted record includes `tenant_id: tenantId` explicitly.
- Every update/count query chains `.eq("tenant_id", tenantId)`.
- Update (`src/lib/import/updateServer.ts`) matches rows by real DB `id`,
  never a business key — and the update query's `.eq("id", x).eq("tenant_id",
  tenantId)` means a cross-tenant id simply matches zero rows and fails
  cleanly, rather than silently updating the wrong tenant's record.

## Before calling a data-access change done

Ask, concretely, not rhetorically: *if a tenant-A user sent this exact
request with a tenant-B id substituted in, what stops it?* The answer has to
name a specific mechanism — "RLS policy `accounts: tenant isolation`" or
"the `.eq("tenant_id", tenantId)` on line 46" — not "should be fine."

Also check for siblings: if you just fixed a cross-tenant-reference gap on
one route (e.g. invoices), grep for the same shape on related routes (quotes,
purchase orders, work orders) rather than fixing one instance and leaving
the rest exposed.

## Known tracked debt (update this list as items are fixed)

- **Legacy v1 API routes** (`src/app/api/v1/{accounts,cases,quotations}`)
  don't actually bind to a tenant via the bearer API key — tenant scoping
  there currently comes from the caller's session cookie, not the key
  itself, so the documented "Bearer VEVEY_API_KEY" model doesn't function
  as advertised for a genuine server-to-server caller. Newer v1 routes
  (`inventory`, `invoices`, `purchase-orders`) already use
  `resolveTenantFromBearer` correctly — migrate the three legacy ones onto
  that.
- **`page_layouts` / `deletion_log`** — live tables, no tracked migration,
  RLS status unverifiable from the repo. Back-fill a migration before
  trusting or extending either.

## What a 2026-07-21 deep audit specifically confirmed safe

A dedicated audit re-checked the exact scenario "one user, two tenants" —
worth knowing so it isn't re-litigated from scratch:
- `unstable_cache` usage in `src/lib/data/live.ts` is safe — verified against
  the actual installed Next.js source (`unstable-cache.js`): call arguments
  are serialized into the cache key unconditionally, and `tenantId` is
  always one of those arguments, so two tenants never share a cache entry.
- Cookies are host-only in the app code — no `domain` option is set anywhere
  in `supabase-server.ts` / `supabase-browser.ts`, and there's no
  `middleware.ts` that could inject one. **Not independently verifiable at
  the deployment/CDN layer from source alone** — if cross-tenant session
  bleed is ever suspected, check whether Vercel or DNS is rewriting
  `Set-Cookie` to a shared parent domain before assuming the app code is at
  fault.
- `revalidateTag("accounts")` / `revalidateTag("cases")` calls use a global,
  non-tenant-scoped tag — this causes tenant A's write to over-invalidate
  tenant B's cache too, but every recompute is still correctly
  `tenant_id`-scoped, so it's a wasted-cache-hit inefficiency, not a leak.
  Not fixed; noted so nobody mistakes it for one later.

## Fixed 2026-07-21 (for context, not action)

- `custom_fields` had no RLS policy at all since it was created (migration
  0011) — added in `0034_custom_fields_rls.sql`.
- Invoice creation (`POST /api/invoices`) didn't verify `quote_id`/
  `contact_id`/`case_id`/`contract_id`/`entity_id` belonged to the tenant.
- Two low-severity missing `.eq("tenant_id", ...)` filters (inventory
  delete's reference-count check, the work-order→invoice conversion's quote
  lookup) — both used the session client so RLS already backstopped them,
  fixed anyway for defense-in-depth and consistency.
