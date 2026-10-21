# Security audit 2026-10-21

Scope: everything committed since 2026-08-01 (pricing engine and RFQs, estimator and fence, products/BOM/suppliers,
coverage, Account 360, D365 connector, Nova, the marketing platform, the AI surfaces, Data Workbench routes for new
objects, v1 additions, WFM, settings routes) plus two full-repo passes: (a) every unauthenticated or signed-link route,
(b) every `createAdminSupabase()` call site. Source-only: nothing was run against a live database.

## Method

- Enumerated all 501 `route.ts` files and, with a script, listed those with no recognised auth helper (`requireTenantUser`,
  `authorizeApi`, `isPlatformAdmin`, the module `*Access` wrappers, `requireWfm*`, `authenticateKiosk`). Read each remaining
  one and each wrapper; read every entry of the `proxy.ts` public-path list and the signature/token check behind it.
- Scripted scan of every `.from("<table>")` chain made on an admin-style client for a missing `tenant_id` filter; read each hit.
- Replayed every migration since 0079: RLS enabled and policy present per new table, then judged each `for all` policy
  against what the table holds (credentials, pay, consent).
- Grepped every server-side `fetch(`, `dangerouslySetInnerHTML`, `<iframe srcDoc>`, `.or(`/`.ilike(` with interpolation,
  `html:` in outbound mail, CSV writers, `storage.from(`, `getUserById` (mail to an id from a body), body-supplied `*_id`.
- Verified the SSRF bypass and token properties by running them in Node (URL hostname normalisation, HMAC domain separation).

## Findings

| # | Sev | Where | Category | Status |
|---|-----|-------|----------|--------|
| H1 | High | `supabase/migrations/0081_api_keys.sql:43`, `0082_webhooks.sql:38` | RLS write path to credentials | Fixed (0199) |
| H2 | High | `supabase/migrations/0049_tenant_connectors.sql:24` | RLS write path to credentials | Fixed (0199) |
| H3 | High | `tenants` row policy (`0000_baseline.sql:423`), `tenants.api_key`, `config.integration_push`, `config.account_360` | Secrets readable by every member | Fixed (0200 + sealing) |
| M1 | Medium | `src/app/api/v1/changes/route.ts:30` | API scope bypass | Fixed |
| M2 | Medium | `src/lib/net/safeHost.ts:14-22` (old) | SSRF guard bypass | Fixed |
| M3 | Medium | `src/lib/webhooks/dispatch.ts:43`, `src/lib/webhookPush.ts:29`, `src/app/api/connectors/[id]/test/route.ts:30,43`, `src/app/api/settings/webhooks/route.ts:69` | SSRF, tenant-typed URL | Fixed |
| M4 | Medium | `src/app/(app)/reports/ReportsClient.tsx:512`, `src/app/api/admin/tenants/[id]/export/route.ts:36` | CSV formula injection | Fixed |
| M5 | Medium | `src/app/api/{import,export,update}/*` (all but employees, product_bom_lines, a few) and the core CRUD routes | Business Role grants are page-level only | Open (systemic) |
| M6 | Medium | `src/lib/marketing/forms/submit.ts:199-258` | Consent recorded for an existing contact from an anonymous form (single opt-in) | Open (by design, see below) |
| L1 | Low | `src/app/api/nova/comments/route.ts:42,89` ; `0089_record_comments.sql:34` | No workcenter check on comments; insert policy lets a member forge `author_email`/`mentions` | Open |
| L2 | Low | `src/app/api/opportunities/route.ts:79`, `opportunities/[id]/route.ts:76-77` | Body `owner_id` and `team[].user_id` not verified as workspace members | Open |
| L3 | Low | every `.../cron/*` route, `src/app/api/webhooks/cron/route.ts:19` | CRON_SECRET compared with `!==` (not constant time) | Open |
| L4 | Low | `src/app/api/auth/face-login/route.ts` | No liveness; a photo signs in as the matched employee (opt-in flag, documented in the route) | Accepted risk |
| L5 | Low | `src/app/api/auth/dev-signin/route.ts` | Mints a magic link for a hard-coded address; gated on `NODE_ENV !== "production"` (Vercel previews are production) | Open, delete the route |

### H1. `api_keys` and `webhooks` are writable by any member (High, confidence 90%)

Both carry `for all` "tenant isolation" policies, so a workspace member (a WFM employee included) can write them through
PostgREST with their own session; the anon key is public by design, the same model that made `wfm_ot_sessions` a finding on
2026-08-12. Exploit: `POST /rest/v1/api_keys` with `tenant_id`, `token_hash = sha256("x")`, `scopes = {read:true, write:true,
objects:["*","employees","rfqs","estimates","contacts","abm_targets"]}`, then `Authorization: Bearer x` on `/api/v1`: full
read/write of the workspace, explicit-scope-only objects included. The admin check in `/api/settings/api-keys` was cosmetic.
`POST /rest/v1/webhooks` with an attacker URL makes the service-role dispatcher post the signed change feed of the whole
workspace to it. Fix: `0199_rls_credential_tables.sql` drops both policies (every route uses the service role with an
explicit `tenant_id`). Test: `src/lib/rlsPolicies.test.ts`.

### H2. `tenant_connectors` is writable by any member (High, confidence 85%)

`config.smtp_host`/`imap_host` of the mail-server connector are non-secret and sit in the same row as the encrypted password.
A member rewrites the host to one they run; the next RFQ send or mailbox poll authenticates to it with the decrypted password
(`src/lib/mail/mailbox.ts:49-62`). Fix: 0199 keeps member SELECT (the RFQ buyer's send path reads it through the session
client) and makes insert/update/delete admin-only. Test: `src/lib/rlsPolicies.test.ts`.

### H3. Secrets readable by every member through the `tenants` row (High, confidence 85%)

"tenants: members read own" is a row policy, so `GET /rest/v1/tenants?select=api_key,config` returns the legacy plaintext
full-access API key and everything in `config`, including `integration_push.webhook_secret` (+ endpoint secrets) and
`account_360.sources[].auth_value` (an auth header for the tenant's own ERP). `redactTenantForRole()` only protects page props.
Fix, two parts: (1) `0200_tenants_hide_api_key.sql` withdraws table-level SELECT from `anon`/`authenticated` and re-grants every
column but `api_key` (every session-client read of `tenants` in the app names its columns; the admin pages that `select *`
use the service role); `src/lib/tenantsColumnGrants.test.ts` fails the build when a later migration adds a `tenants` column
without a grant. (2) The two config secrets are sealed with `FIELD_ENCRYPTION_KEY` (`sealSecret`/`unsealSecret`, idempotent,
legacy plaintext still read and sealed on the next save); admins get the real value, members never. Test:
`src/lib/secretSealing.test.ts`. Residual: until 0200 is applied the legacy `api_key` stays readable; until each admin re-saves
Account 360 sources/ERP push, the old plaintext stays in `config`. Rotate the legacy key (`Settings > General > Developer`) after applying 0200.

### M1. `/api/v1/changes` ignored object scope (confidence 90%)

Any read-scoped key got the change history of every object. A `products`-only key read employee, RFQ (supplier price) and
estimate changes plus `cost_price` from/to; a `*` key read the objects the wildcard is documented not to reach. Fixed in
`src/lib/api/changeFeedScope.ts` (type -> scope map; explicit-only objects need naming; `cost_price` stripped). Test:
`changeFeedScope.test.ts`. Behaviour change: wildcard keys no longer see employees/contacts/rfqs/estimates/ABM-target changes.
Outbound webhooks (admin configured, not key scoped) are unchanged.

### M2. SSRF guard let IPv4-mapped IPv6 through (confidence 85%)

`new URL("https://[::ffff:127.0.0.1]/").hostname` is `[::ffff:7f00:1]`; the check matched only the dotted form, so mapped
loopback/metadata, NAT64 (`64:ff9b::`), 6to4 and IPv4-compatible spellings counted as public. It guards Account 360 sources, the
tenant mail host and D365. Fixed: full IPv6 parser, embedded-IPv4 check, extra v4 ranges; test `src/lib/net/safeHost.test.ts`.
Residual: resolve-then-fetch is not pinned (DNS rebinding); `fetchPublic` re-validates redirects but not the connect address.

### M3. Tenant-typed URLs fetched without the guard (confidence 80%)

Outbound webhooks (https only, any host), the ERP push (`http`/`https`, any host), the Slack/iCal connector test. Now
`fetchPublic()` (public host, per-hop redirect check, credentials dropped across origins) at send time, plus a save-time check
for webhooks and ERP push. Blind SSRF (status only), admin-only to configure.

### M4. CSV formula injection (confidence 85%)

Reports "Export CSV" wrote the account name inside quotes only; the platform-admin tenant export wrote raw values. Both now use
`csvCell` (leading `= + - @ tab CR` neutralised). The newer exporters were already safe.

### M5. Business Role grants are not enforced server-side on most routes (confidence 90%, systemic)

`resolvePermissions` is applied by page guards and a handful of routes (employees DW, BOM, pricing settings, module `*Access`).
The Data Workbench import/export/update routes and the core CRUD routes (`accounts`, `contacts`, `quotes`, `invoices` ...) check
only the module flag, so a member whose Business Role withholds a workcenter can still `POST /api/export/accounts` or call the
CRUD API directly. Not fixed: it is cross-cutting, and a central `requireWorkcenterApi()` needs the owner's decision on the
intended contract (are roles a UI convenience or a boundary?). Members with no Business Role are unrestricted by design.

### M6. Public form can record consent for an existing contact (confidence 80%, design)

`handleSubmission` matches an existing contact by email hash and, when the consent box is ticked and the form is not double
opt-in, writes a `granted` ledger row for that person; anyone who knows an address can "consent" for it. Double opt-in
(`confirm_by_email`) is built and closes this. Recommend making it the default where `jurisdiction` requires proof of consent.

### Low items

L1 comments: any member can read/post comments on any object type of the workspace (Nova-only surface). L2: an unknown
`owner_id` is stored; nothing is emailed or displayed from it, so integrity only. L3: constant-time compare for high-entropy
bearer secrets is hygiene. L5: the dev sign-in route has no production guard that survives a preview deployment; delete it.

## Confirmed clean (checked, found sound)

- Every `proxy.ts` public path: `/api/f/[key]`, `/api/marketing/{confirm,preferences,unsubscribe,interest}`, `/marketing/{c,o}`,
  `/api/rfq-reply/*`, `/api/inbound/email/*`, `/api/inbound/whatsapp/[key]`, `/api/webhooks/resend`, `/api/auth/*` pre-session
  routes, kiosk routes, all cron routes (`!process.env.CRON_SECRET ||` guard present on all 12).
- Tokens: confirm (7-day expiry inside the signed text, domain label `doi.`), preference (`pref.`), unsubscribe, interest,
  newsletter click/open (index not URL, token verified before any read), RFQ reply (nonce rotation, host-bound), OAuth state
  (tenant-bound, 10 min, PKCE cookie for D365): all `timingSafeEqual`, labelled; cross-use between labels is not possible.
- Signatures: Svix (5 min skew, empty secret refused), generic HMAC, WhatsApp (secret per stored identity, raw body, tenant from
  the row), kiosk device token (hash), passkey/face login (tenant from host, generic errors, membership + lock checks).
- Public form submit: body capped before parse, tenant from the form's key, honeypot + signed render token + per-IP limits,
  every query `tenant_id`-scoped, emails escaped, display name header-safe; confirm/preference pages change nothing on GET.
- Inbound email: tenant from the signed reply-to code; attachments through `storeAttachment` (type allow-list, random name).
- XSS: the only `dangerouslySetInnerHTML` is the sanitized scope-of-work; newsletter preview iframes are sandboxed; newsletter
  blocks store plain text and the renderer escapes; thank-you/notice/reset emails escape every value; `html:` bodies elsewhere
  are template-built with escaped custom text.
- AI: `/api/v1/ask` and `/api/reports/ask` compile to a structured query validated by `parseListQuery` against the field
  whitelist (no model SQL, no model tenant); intake, RFQ reply reader and Nova draft only propose, a human saves.
- PostgREST filter strings: every `.or(...)` with interpolated user text goes through a sanitiser that strips `, ( ) % * \`.
- Headless Chromium: `htmlToPdf` and the quote PDF POST intercept requests (data:, same origin, tenant logo allow-list).
- Storage: new buckets are private; downloads are signed after a tenant-scoped row check (`rfq` path is re-matched to a message).
- Account 360 external fetch: https only, public host, redirects refused; settings routes admin-only both ways.
- D365: environment host allow-listed and re-validated at use; token fetch `redirect: "error"`.
- Admin routes: every `/api/admin/*` route calls `isPlatformAdmin()`; `tenants.features` is written only there.
- Every other table created since 0079 has RLS and a policy in the same migration; WFM-style tables are select-only; service-only
  tables (`whatsapp_identities`, `wfm_kiosk_devices`, `wfm_push_subscriptions`, `rfq_mailbox_state`, journey locks) have none.
- Scripted admin-client scan: every remaining hit without a literal `tenant_id` is a prepared row that carries it, a cron/system
  read, a lookup by a signed or hashed credential, or a child-table read under an already tenant-verified parent.
- CSV writers added since August (estimator `tableToCsv`, quote export, DW) neutralise formulas.

## Could not verify from source

- Live RLS state and whether 0199/0200 are applied (migrations are applied by hand); whether the Supabase REST API is exposed
  as assumed; Supabase default grants on `tenants` (0200 assumes the standard `authenticated`/`anon` table-level SELECT).
- Cookie `Set-Cookie` rewriting at the CDN, Vercel host routing for unknown `Host` headers, and Supabase Auth's own rate limits.
- Whether any tenant has generated a legacy `tenants.api_key` (decides the real exposure of H3 part 1) or configured Account 360 sources.
- DNS rebinding between `assertPublicHost` and the connect.
