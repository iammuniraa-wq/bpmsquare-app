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

- ~~**Legacy v1 API routes** (`src/app/api/v1/{accounts,cases,quotations}`)
  don't actually bind to a tenant via the bearer API key~~ — **Fixed
  2026-07-26.** `listAccountsLive`/`getAccountHubLive`/`listCasesLive`/
  `listQuotesLive` (`src/lib/data/live.ts`) were refactored to extract
  `listAccountsForTenant`/`getAccountHubForTenant`/`listCasesForTenant`/
  `listQuotesForTenant` (same pattern as `getQuoteForTenant`), and all four
  legacy v1 routes now use `resolveTenantFromBearer` exactly like
  `inventory`/`invoices`/`purchase-orders` already did — there is no longer
  a global `VEVEY_API_KEY`, every v1 route resolves its tenant from a
  per-tenant key on `tenants.api_key`. `src/app/api/v1/_auth.ts`'s dead
  `checkApiKey`/`ERR_401` were removed. Settings → General → Developer now
  shows the tenant's real key with a self-service "Generate/Regenerate"
  button (`POST /api/settings/api-key`, admin-only) instead of a hardcoded
  `"dev-key"` placeholder that never matched any real auth path.
  `mcp-server/mcp.json`'s auth section and description (which named Vikas
  Pioneers specifically, despite every tool in it being fully generic) were
  updated to match. **Not independently verified against a live database**
  from this environment — the refactor mirrors the proven
  `getQuoteForTenant` extraction exactly and `tsc`/`next build` are clean,
  but this is the first real-world exercise of these four routes' new auth
  path; watch for issues on first live use.
- ~~`page_layouts` / `deletion_log`~~ — `page_layouts` now has a tracked
  migration (`0039_page_layouts_rls.sql`, 2026-07-25). `deletion_log` no
  longer exists as a table at all — `/api/deletion-log` reads/writes a
  JSONB array inside `tenants.config` instead; that half of this item was
  stale and is dropped.

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

## Fixed 2026-07-26 — audit of the marketing/leads/search features

A four-agent audit (multi-tenant isolation, auth/access-control, injection/
XSS, secrets/config/logic-bugs) scoped to everything built since the
2026-07-25 audit: marketing campaigns, Segmentation, target groups, leads
(including the new campaign-interest-link attribution), and global search.
Most of this surface held up — every new table has RLS + a same-migration
tenant-isolation policy, every admin-client query is `tenant_id`-scoped,
the two new signed no-login links (campaign-interest, and the existing
unsubscribe link) both verify their HMAC token before touching the
database, and `globalSearchLive`'s `.or()` ILIKE construction has no
injection path (PostgREST's filter DSL never reaches raw SQL, and the only
special characters that matter for its own condition-separator syntax —
`,` and `()` — are stripped by `sanitizeSearchTerm`). Five real findings,
all fixed:

**Medium-High — unescaped account name interpolated into real outbound
marketing-email HTML.** `renderTemplate()` (`lib/emailTemplates.ts`) does a
raw substitution with no HTML-escaping, and the marketing send route
(`api/marketing/campaigns/[id]/send/route.ts`) used it to build the actual
`html:` body sent via Resend, substituting `account_name`/`company_name`
directly from `accounts.name` -- free text any tenant user (not just an
admin) can set when creating an account. The custom-message field in the
same template is properly escaped via `escapeCustomMessage()`; the account
name wasn't, which was the actual gap -- any account whose name contained
markup would have that markup land, unescaped, in a real email sent to that
account's own contact. Fixed: added `escapeHtml()` (`lib/emailTemplates.ts`)
and applied it to `account_name`/`company_name` specifically for the
HTML-body render (`bodyHtml`), leaving the plain-text `subject` render on
the original unescaped `vars` since HTML-escaping a subject line would
incorrectly show literal `&amp;` etc. Confirmed the only other
`renderTemplate()` caller with untrusted vars (`api/quotes/[id]/email/route.ts`)
sends its result as a `text:` field, not `html:`, so it was never at risk.

**Low/Medium — the tenant's real v1 API key and ERP webhook-signing secret
were readable by every authenticated member, not just admins.** Both
`Tenant.api_key` and `TenantConfig.integration_push.webhook_secret` were
part of the full tenant row `getTenant()` fetches, and that whole object
was handed to `TenantProvider` in `app/(app)/layout.tsx` for every logged-in
user regardless of role -- the Settings page's admin-only gating was
UI-only, not backed by the data actually being absent for non-admins.
`GET /api/settings/integration-push` additionally had no role check at all
(unlike its own `PATCH`), so a non-admin could also fetch the secret
directly. Regenerating either was already correctly admin-gated; reading
wasn't. Fixed: added `redactTenantForRole()` (`lib/tenant.ts`), applied at
the `TenantProvider` boundary in `layout.tsx` -- a non-admin's tenant
context now has `api_key: null` and `config.integration_push.webhook_secret`
stripped (its `webhook_url` is left visible, since that's not sensitive).
Added the missing `role !== "admin"` check to the `GET` handler in
`api/settings/integration-push/route.ts` as defense in depth.

**Low — race condition in campaign-interest lead dedup.**
`createCampaignInterestLeadLive`'s check-then-insert (`lib/data/live.ts`)
had no unique constraint behind it, so a double-click or a mail-client/
security-scanner link prefetch hitting the same interest link twice in
close succession could create two duplicate leads for the same
account+campaign. Fixed: `supabase/migrations/0046_leads_campaign_dedup_constraint.sql`
adds a unique index on `leads (account_id, source_campaign_id) where
source_campaign_id is not null`; the insert now treats a `23505`
(unique-violation) error as success rather than a failure.

**Informational — the new unsubscribe/interest public-path regexes in
`middleware.ts` weren't `$`-anchored**, so they'd also match a hypothetical
deeper path under the same prefix. Not exploitable today (no such route
exists), but a latent footgun if one is ever added later with different
auth requirements. Fixed: anchored all four regexes with `$`.

## Fixed 2026-07-25 — full codebase security audit

A five-agent audit (multi-tenant isolation, auth/session/middleware,
injection/XSS, secrets/encryption/config exposure, uploads/integrations)
covering the whole app, not just a diff. One item below needs action from a
human with Supabase dashboard access — everything else is a code fix,
already applied.

> ⚠️ **Action still required, not something code can fix**: `scripts/
> push-seed-to-supabase.mjs` had a live, permanent-expiry Supabase
> `service_role` key hardcoded and already pushed to `main` on GitHub. The
> script now reads `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL`
> from the environment like every other server file — but **the exposed key
> itself must still be rotated in the Supabase dashboard** (Project Settings
> → API → reset `service_role`) if that hasn't happened yet. Nothing else in
> this list matters if that key is still live.

**Critical — cross-tenant data leaks via unverified foreign ids.** Same root
cause as the invoices-route fix on 2026-07-21, found in three more places by
grepping every `createAdminSupabase()` call site for a matching
`.eq("tenant_id", ...)`:
- `quotes.contact_id` / `quotes.asset_ids` — unverified in `POST
  /api/quotes` and `POST /api/quotes/[id]/edit`; `getQuoteForTenant`
  (`src/lib/data/live.ts`) then fetched and *decrypted* the foreign
  contact's PII with no tenant filter. Worst path: a dual-tenant user (the
  guardrails intro's own example — platform admins always are one) sets
  `contact_id` on a tenant-A quote to a contact they know from tenant B;
  that contact's decrypted name/phone/email then renders on the tenant-A
  quote, including through the public print/WhatsApp link.
- `service_cases.asset_ids` / `asset_id` — same shape, `getCaseLive`.
- `accounts.referred_by_account_id` — same shape, `getAccountHubLive`
  (lower impact: only a foreign account's name leaks).

  Fixed by adding the same `.eq("id", x).eq("tenant_id", tenantId)`
  pre-check the invoices route already used, to `POST/PATCH` on
  `/api/quotes`, `/api/quotes/[id]/edit`, `/api/cases`, `/api/cases/[id]`,
  `/api/accounts`, `/api/accounts/[id]`.

**High — storage bucket RLS didn't check tenant.**
`0014_storage_company_assets.sql`'s insert/delete policies only checked
`bucket_id = 'company-assets'`; the tenant-id folder prefix used by `/api/
upload` was an app-level convention only, so any authenticated user of any
tenant could call the Storage API directly (their own real session, not
through the app) and overwrite/delete another tenant's logo objects. Fixed
in `0038_storage_tenant_isolation.sql` — policies now also check
`(storage.foldername(name))[1]` against `tenant_users`. Same migration also
adds the first-ever tracked migration + admin-only policies for the
`logos` bucket (used by `/api/admin/upload-logo`), which had neither.

**High — Next.js pinned to a version with a real advisory range covering a
middleware-bypass CVE** (notable specifically here since `middleware.ts` is
this app's actual tenant-resolution boundary). Upgraded `16.2.6` →
`16.2.12`. Residual `npm audit` high-severity entries on `sharp`/`postcss`
are Next's own internal transitive pins (no independently newer version
published yet) — confirmed low real exposure since nothing in this app's
code feeds untrusted input through `next/image` or a PostCSS build step on
user content.

**Medium — open redirect + reflected XSS chained through the `next` param**
(`src/app/login/LoginForm.tsx`, `src/app/auth/callback/route.ts`). Two
distinct bugs sharing one root cause (an unvalidated `next` query param):
1. Open redirect — `next` was used as `${origin}${next}`/`window.location.href
   = next` with no check it was an internal path, so `next=.evil.com` turned
   `https://app.bpmsquare.com` into `https://app.bpmsquare.com.evil.com` (an
   attacker-owned domain) right after a genuine login/magic-link/invite
   completed.
2. Reflected XSS — the callback route's implicit-flow HTML interpolates
   `next` directly into `'${next}'` inside an inline `<script>` tag with **no
   escaping**. A `next` value containing a quote character could break out
   of the JS string literal and inject arbitrary script, which would run in
   the real app origin mid-authentication — chained with session cookies
   being non-`httpOnly` (a `@supabase/ssr` architectural requirement, not a
   bug — see below), this was a full session-hijack primitive delivered via
   what looks like a legitimate auth link.

   Both closed by one fix: `src/lib/safeRedirect.ts`'s `safeInternalPath()`
   restricts `next` to a strict internal-path charset (must start with `/`,
   not `//`, no quotes/backslash/angle-brackets/semicolons/whitespace) —
   applied in `LoginForm.tsx` and `auth/callback/route.ts`. The charset
   restriction closes the injection too, since a validated path can never
   contain the quote character needed to break out of the string literal.

**Medium — CSV/formula injection in every CSV export.** Neither CSV writer
(`esc()` in `src/app/api/quotes/[id]/export/route.ts`, `csvCell()` in
`src/lib/import/template.ts` — the latter shared by every Data Workbench
export) neutralized a cell starting with `=`/`+`/`-`/`@`, which Excel/
LibreOffice run as a formula on open. Both are fed by attacker-influenceable
tenant data (quote/account/contact names, notes, line descriptions). Fixed:
both now prefix such cells with `'` before quoting, forcing plain-text
interpretation.

**Medium — SVG upload → stored XSS.** `/api/upload` (no role gate at all —
any authenticated tenant member, not just admin) and `/api/cases/[id]/
photos` (a `.startsWith("image/")` fallback let SVG through even though it
wasn't in the explicit allowlist) both accepted `image/svg+xml` into a
public bucket; an SVG can carry a `<script>`/`onload` payload that executes
when its public URL is opened directly. Fixed: SVG removed from all three
upload routes (`/api/upload`, `/api/admin/upload-logo`, `/api/cases/[id]/
photos` — logos/photos all render fine as raster); `/api/upload` now also
requires `role === "admin"` (matching Settings → Entities' existing
`adminOnly: true` nav gate, which was never enforced server-side). Also
fixed a related MIME/extension-mismatch gap in `/api/upload` and `/api/
admin/upload-logo`: both validated one of {declared MIME type, filename
extension} but stored the *other*, unvalidated one — the storage path's
extension is now always derived from the validated MIME type, never from
the attacker-supplied filename.

**Medium — `FIELD_ENCRYPTION_KEY` unset silently wrote plaintext PII.**
`encrypt()`/`decrypt()` (`src/lib/encryption.ts`) fell back to a no-op with
zero signal if the key was missing — every account/contact PII write would
silently land in the DB as plaintext. Not changed to a hard throw (that
would turn one missing env var into a full outage on every account/contact
read+write); now logs a loud `console.error` once per process instead, so
it's impossible to miss in server logs.

**Low — v1 bearer API key comparison wasn't constant-time.**
`checkApiKey()` (`src/app/api/v1/_auth.ts`) used plain `===`, a narrow
timing side-channel for recovering the key over many requests. Fixed via
`crypto.timingSafeEqual` over SHA-256 digests of both sides (hashing first
sidesteps `timingSafeEqual`'s equal-length requirement without a
length-revealing pre-check).

**Low — session cookies had no explicit `secure` flag.**
`@supabase/ssr`'s own defaults set no `secure` key at all (`httpOnly:
false` is required by its architecture — the browser client reads the same
cookie via `document.cookie` — so that one is intentionally left as-is).
Added `SUPABASE_COOKIE_OPTIONS` (`src/lib/constants.ts`,
`{ secure: NODE_ENV === "production" }`) to every `createServerClient`/
`createBrowserClient` call (`supabase-server.ts`, `supabase-browser.ts`,
`middleware.ts`, `auth/callback/route.ts`, `api/auth/session/route.ts`) —
conditional on `NODE_ENV` so `http://localhost` dev still works.

**Low — `page_layouts` back-filled** with a tracked migration
(`0039_page_layouts_rls.sql`) — see the tracked-debt section above.

**Low — basic recipient format validation** added to `POST /api/quotes/
[id]/email` before handing a client-suppliable `email` field to Resend.

**Confirmed clean, no action needed** (so it isn't re-litigated later):
encryption correctness (AES-256-GCM, random IV per call, auth tag verified
on decrypt, no hardcoded key fallback); no hardcoded secrets anywhere else
in tracked files; `SUPABASE_SERVICE_ROLE_KEY` never reaches a client
bundle; the two `NEXT_PUBLIC_` vars in use are the standard
designed-to-be-public Supabase anon credentials; the new public quote-PDF
link (`lib/quotePublicLink.ts`) is timing-safe and fails closed; the
`scope_of_work` rich-text sanitizer has no bypass (every write path runs it,
`revise`/`copy` only ever copy an already-sanitized value); no raw-string-
built Supabase filters anywhere in `src/`; the PDF-rendering routes'
headless-browser navigation can't be redirected to an external/internal-
network URL (no SSRF); Data Workbench routes all still match the documented
shape; `unstable_cache` keys are still always `tenantId`-scoped; admin
routes still gate server-side via `isPlatformAdmin()`; no rate limiting
exists on `/login` or the v1 bearer key (relies on Supabase Auth's own
project-level limits — worth confirming those are adequate, not a code bug
here).

## Fixed 2026-07-21 (for context, not action)

- `custom_fields` had no RLS policy at all since it was created (migration
  0011) — added in `0034_custom_fields_rls.sql`, **applied to the database**.
- Invoice creation (`POST /api/invoices`) didn't verify `quote_id`/
  `contact_id`/`case_id`/`contract_id`/`entity_id` belonged to the tenant.
- Two low-severity missing `.eq("tenant_id", ...)` filters (inventory
  delete's reference-count check, the work-order→invoice conversion's quote
  lookup) — both used the session client so RLS already backstopped them,
  fixed anyway for defense-in-depth and consistency.
