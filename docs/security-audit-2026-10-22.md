# Security audit 2026-10-22

Scope: everything on `develop` since the last reviewed commit `fdf214ba` (`fdf214ba..cebe690e`, 69 commits, 513 files):
Webhooks library (0202), SAP S/4HANA connector, Mapping engine (0203), Resync scope and specific-record filters, Integration
middleware round 2 and Monitor, Settings simplification (People, Quotations, Pricing, Company, Appearance, Products, Workforce,
Marketing Consent/Limits/Leads), the daily briefing (0204) and capability/flag plumbing. Plus a repo-wide secret scan (tracked
files and the last 300 commits) and `npm audit --omit=dev`. Source-only: nothing was run against a live database.

## Method

- Read every new or changed `route.ts` in the range and its guard (`api/middleware/_guard.ts`, `api/settings/webhooks-library/_guard.ts`,
  `loadMarketingSettingsContext`, `newsletterAccess`/`journeyAccess`, `briefingResponse`); confirmed admin + flag + session tenant.
- Scripted list of every `.from(...)` in the new server code without a `tenant_id` on the same line; read each multi-line chain.
- Replayed 0202, 0203, 0204 for RLS against the 0199 lesson (no member write on anything that holds a credential or steers the server).
- Followed every tenant-typed URL to its fetch (`fetchPublic` / `assertSafeHttpsUrl`), including redirect handling, and every place a
  user value reaches an OData `$filter`, a PostgREST `.or()`, a CSV cell, a header, a template or an AI prompt.
- Secrets: `git grep` and `git log -300 -S/-G` for `QHaiTM6L`, `client_secret`/`APIKey`/`password` literals, JWTs, `whsec_`, `sk-`,
  private keys, tracked `.env`/key files; `NEXT_PUBLIC_*` inventory; `console.*` added in the range.

## Findings

| ID | Sev | Where | What | Exploit (short) | Fix | Conf. |
|----|-----|-------|------|-----------------|-----|-------|
| D1 | High | `package.json` `next@16.2.12` | npm marks Critical: RCE (Windows host; Image Optimization with AVIF; `next/og`), SSRF in Image Optimization, ISR/SSG cache poisoning (all `<16.3.3`/`<16.3.8`) | App uses neither `next/image` nor `next/og` and runs on Vercel Linux, but `/_next/image` is on by default and the SSRF/cache-poisoning ranges apply | Upgrade to `next@16.4.2` (non-major per npm), `tsc` + `next build` | 80% |
| D2 | High | `package.json` `nodemailer@9.0.3`; used per tenant in `src/lib/mail/mailbox.ts`, `src/lib/connectors/gmailReply.ts` | Advisory: process-global DNS cache reuses TLS `servername` across transports, "cross-tenant SMTP credential disclosure" (`>=5 <10.0.2`); plus recipient-domain bypasses and address-parser DoS | A warm instance serving two tenants' mail-server connectors can authenticate tenant A's SMTP login against tenant B's resolved host | Upgrade to the latest `nodemailer` 10.x above 10.0.5 (major: check `createTransport` options) | 70% (advisory-level, not reproduced) |
| M1 | Medium | `src/lib/net/safeHost.ts:150-165` (callers `src/lib/connectors/sap_s4/server.ts:186`, `src/lib/connectors/sap_s4/odata.ts:95`, `src/lib/webhooks/sender.ts:254,325`) | `fetchPublic` follows up to 3 redirects and strips only `authorization` and `cookie` on a cross-origin hop. Custom credential headers (SAP `APIKey`, every sealed Call-webhook header value) and the signed body (307/308) are forwarded to the new origin, including an `https` to `http` downgrade (`assertPublicHttpUrl` accepts http). It also overrides the caller's `redirect: "error"` (the SAP client asks for it) with `"manual"` | A receiver (or an open redirect on it) answers 307 `Location: http://other-host/`; the sealed `X-Api-Key`/`APIKey` value and the PII body go there in clear text. Breaks the "write-only, pinned host" promise of 0202 and the SAP sandbox allow-list | On a cross-origin or scheme-changing hop keep only an allow-list (`accept`, `content-type`, `user-agent`), refuse `https`→`http`; honour `init.redirect === "error"`; SAP and webhook senders pass `maxRedirects: 0` or same-origin only | 90% |
| M2 | Medium | `supabase/migrations/0052_business_roles.sql:28,59,82`; `src/lib/permissions.ts:52-61` | Pre-existing (not in this range), surfaced by the People review: `business_roles`, `business_role_grants` and `business_user_roles` have `for all` tenant-isolation policies, so any member writes them through PostgREST; the admin checks in `/api/business-roles*` and `/api/settings/team/[id]/roles` are UI-only for these tables | A member restricted by a Business Role sends `DELETE /rest/v1/business_user_roles?user_id=eq.<self>`; `resolvePermissions` then returns `UNRESTRICTED` (no role = full member access). Or inserts grants (`can_delete`) into their own role. No path to `admin` (`tenant_users` has no member write policy) | New migration: member SELECT only; INSERT/UPDATE/DELETE only for `tenant_users.role = 'admin'` of the row's tenant (the 0199 `tenant_connectors` pattern; routes write with the session client, so an admin write policy is needed). Add the three tables to `src/lib/rlsPolicies.test.ts` | 85% |
| D3 | Medium | `@tiptap/core`, `prosemirror-view` (`src/components/RichTextEditor.tsx`), `@xmldom/xmldom@0.8.13` via `mammoth` (`src/lib/import/parseServer.ts`) | Editor: paste-handling XSS and `__proto__` attribute injection; xmldom: quadratic parse / ReDoS on a crafted .docx | Pasting crafted HTML from a hostile page runs script in the app origin (stored HTML is sanitised server-side, so not stored XSS); a crafted .docx import ties up a function | `npm audit fix` for tiptap/prosemirror; bump `mammoth` when it ships xmldom `>=0.8.15` or cap .docx size | 70% |
| L1 | Low | `src/app/api/settings/webhooks-library/route.ts:27`, `src/lib/webhooks/library.ts:333`, `src/lib/webhooks/render.ts:139`; `supabase/migrations/0050_change_log.sql:37` | Header values are sealed, but the webhook address is treated as non-secret and written in clear to `change_log` (create and every URL edit), which every member can read through PostgREST. Many receivers carry the credential in the URL (Slack/Teams incoming-webhook paths, Power Automate `sig=`, Azure Functions `code=`); `validateUrlTemplate` refuses none of them (schema discovery's `SECRET_PARAM` does) | A member reads `GET /rest/v1/change_log?object_type=eq.webhooks` and posts forged records straight to the receiver | Refuse credential-looking query names in `validateUrlTemplate` (reuse `SECRET_PARAM`, point to Headers); log host + "address changed" instead of the full URL | 85% |
| L2 | Low | `src/app/api/connectors/cron/sap_s4/route.ts:19` | New cron compares `CRON_SECRET` with `!==` although `cronSecretOk()` (constant time) now exists and the prune cron uses it | Timing side channel on a high-entropy secret (hygiene, same as 2026-10-21 L3) | `cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)` | 95% |
| L3 | Low | `src/lib/connectors/sap_s4/server.ts:551-553`, `src/app/api/connectors/cron/sap_s4/route.ts:25-40` | Scheduled SAP pulls check the target module flag but not `integration_middleware`, the only place SAP can be configured | A workspace whose middleware module is switched off by the platform admin keeps importing SAP data hourly with no screen to see or stop it | Return early when `features.integration_middleware !== true` (schedule trigger at least) | 80% |
| L4 | Low | `src/lib/webhooks/sender.ts:245`, `src/lib/connectors/sap_s4/odata.ts:96` | Response bodies of tenant-typed hosts are read whole (`res.text()`) before the 8 000-char slice; no byte cap (schema discovery has `readBounded`) | A hostile or broken receiver streams hundreds of MB, exhausting the shared warm instance | Reuse `readBounded()` (e.g. 1 MB for webhooks, 20 MB for SAP pages) | 80% |
| L5 | Low | `src/lib/middleware/messages.ts:186-191`, `vercel.json:78-79` | Captured request/response payloads (PII when a webhook allows personal data) are promised for 48 h but the prune runs once a day, so they live up to ~72 h | Retention statement in the spec and capability text is not what happens | Run the prune hourly, or hide `payload` older than 48 h on read | 90% |

### M1 in more detail

`fetchPublic` (`safeHost.ts:143-168`) does `fetch(url, { ...init, method, body, headers, redirect: "manual" })`, so whatever the caller set
as `redirect` is ignored. On a hop to another origin it builds `new Headers(headers)` and deletes `authorization` and `cookie` only.
The SAP client puts the sandbox key in `APIKey` (`sap_s4/server.ts:173`) and the webhook sender puts each unsealed custom header
in by name (`sender.ts:169-173`); both survive the hop. The SAP sandbox host is pinned at use (`catalog.ts:76-82`), so the APIKey
leaks only if `sandbox.api.sap.com` itself redirects; the webhook case needs only the receiver (or an open redirect on its domain).
The comment in `sap_s4/odata.ts:7-8` ("the login can not be sent anywhere else") does not hold for the API-key mode.

### M2 in more detail

Same family as the 2026-08-12 WFM and 2026-10-21 credential-table findings: an admin check in a route does not protect a table a
member can write. `tenant_users` is safe (member SELECT only), so this is not an admin escalation; it defeats Business Roles, which
the 2026-10-21 audit (M5) already noted are enforced by page guards only. Fixing M2 is cheap and independent of the M5 decision.

## Confirmed clean (checked, found sound)

- **Guards.** Every `/api/middleware/*` route (incl. the SAP branches behind `wantsSap`) and every `/api/settings/webhooks-library/*`
  route: signed-in admin, module flag (404 otherwise), tenant from the session only. `_guard.ts` change was a blank line.
  `marketing-limits`, `marketing-consent`, `marketing-handover`, `marketing-scoring`, `brand-kit`: admin + program gate unchanged;
  limits are validated, refused not clamped. Newsletter send needs Newsletters edit and Campaigns edit; journey newsletter-version
  needs Journeys edit and Newsletters edit.
- **People / settings simplification.** No server route changed: `/api/settings/team*`, `/api/business-users*`, `/api/business-roles*`
  writes are all `role !== "admin"` 403. Folded-page redirects (`settingsFolded.ts`, `peopleRedirect`) go to fixed internal paths, only
  the query is carried: no open redirect. Workforce employment codes: server (`api/settings/workforce/route.ts:131`) still validates
  with `CODE_RE` and de-dupes; "locked after saving" is a UI convenience.
- **Migrations.** 0202 adds no policy (webhooks stays service-role only after 0199); legacy secrets copied as stored (sealed or
  plaintext, both read by `unsealSecret`), legacy keys idempotent. 0203: both tables RLS on, no policy. 0204: own-row SELECT only,
  no write policy. No `tenants` column added (0200 grant rule n/a).
- **Webhooks library.** Signing secret returned once on create/regenerate, `"set"` afterwards; header values sealed, only names
  returned (list, preview, test, Monitor) and only names in change history. Header names `^[A-Za-z0-9-]{1,64}$`, `Host`,
  `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `TE`, `Trailer`, `Proxy-Authorization` and `X-BPMSquare-*` refused,
  CR/LF/NUL refused, BPMSquare headers set last. Template is parsed as JSON first and filled by tree walk (no string splicing), tokens
  from a closed whitelist, PII tokens need the switch, 16 KB template / 256 KB body caps. URL: https only, tokens never in the host,
  no PII or list tokens, re-validated and URL-encoded at send, host re-checked by `fetchPublic`. Every webhook id from a body or a
  config (Links `verifyCallWebhook`, Coverage `resolveCoverageWebhook`, account button, mapping connection `resolveConnection`,
  restart) is loaded with `.eq("tenant_id")`; a foreign id fires nothing. Idempotency key stable across restart; award claim uses the
  0201 unique index. Demo workspace records and sends nothing. Account send picks the webhook server-side from Coverage/button only.
- **SAP S/4HANA.** Password and API key stored with `encrypt()` (AES-GCM), never in `publicState`, never in an error or log; the
  smoke script reads them from env and prints neither. API-key mode pins `sandbox.api.sap.com` at save and at use
  (`sapOrigin`). Basic auth only to `https://<validated host>` (`normalizeHost` rejects http, path, userinfo; `assertSafeHttpsUrl` at
  save and per client). Server `__next` links: only the query is reused on our own base. `$filter`: ids via `parseSelection`
  (GUID or `[A-Za-z0-9._-/#]{1,60}`) + `odataString`, scope attributes `IDENT_RE`, values typed and quote-doubled, field map
  `SAP_FIELD_RE`, 100 ids / 5 conditions / 50 values / filter-length caps. Metadata cache key carries `tenantId`.
- **D365 Resync scope and selection.** Same rules (`selection.ts`, `scope.ts`): GUID or strict number pattern, identifiers only,
  F&O enum type pattern, Dataverse options integers, lookups GUIDs; `scopeServer.ts` quote-doubles names and the `q` search.
- **Mapping engine.** Schema fetch: https + public host, credential query names refused, `maxRedirects: 0`, byte cap (5 MB / 10 MB)
  and timeout. XML read by regex with no entity expansion or external fetch (no XXE). YAML reader refuses anchors, aliases, tags,
  merge keys, multiple documents and `__proto__`-style keys, depth 40. Converters are a closed set (no eval, no regex from input).
  Value-list CSV: 1 MB / 2 000 rows, export through `csvCell`, filename slugged. AI step sends field labels/types only, cleans
  `<>`/newlines, wraps data in `<fields>`, accepts only ids it issued, converter from the type gate, needs `ai_assistant`, metered.
  Webhook headers are unsealed for discovery only when ticked, for that request (an admin could equally repoint the webhook URL).
- **Monitor / restart / payloads.** Every message, run and webhook lookup is tenant-scoped; ids from another workspace are
  "not_restartable"; restart capped at 50. Stored payload: path only (no host or query), secret keys, bearer/JWT, e-mail and phone
  redacted, 24 000-char cap. The keyset cursor is interpolated into `.or()` but only AND-ed under the separate `tenant_id` filter
  (no cross-tenant effect). Prune cron uses `cronSecretOk` (constant time, fails closed) and names the tenant on every statement.
- **Briefing.** Tenant, user, role, features and perms from the session; the request carries only a validated language tag.
  Every query has `tenant_id` plus the person's own column (`actor_id`, `author_id`, `created_by`, `owner_id`, `owner_user_id`,
  `user_id`), leads filtered by owner, mentions by the person's e-mail and object visibility, WFM queues by supervisor scope,
  integration failures admin-only. Store keyed `(tenant_id, user_id, day)`, service-role writes, no `unstable_cache`.
- **Capability/flags.** `webhooks_library` is platform-admin-only, default off; `facts.generated.json` holds descriptions only.
- **Secrets.** `QHaiTM6L`: no hit in tracked files, the working tree or the last 300 commits. No `client_secret`/`APIKey`/password
  literal, private key, `whsec_`/`sk-`/`re_` token, or tracked `.env`. Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_GUIDE_BASE_URL` reach the client. The only `console.*` added in the range logs a store error message (no data).
  History still contains the 2026-07-25 `service_role` JWT (`b4581242`, removed in `b830b8b9`); rotation was required then and is
  not re-raised here.

## npm audit --omit=dev (2026-10-22)

44 advisories: 1 critical, 9 high, 34 moderate. Critical/high that matter: `next` (D1), `nodemailer` (D2), `@tiptap/core`,
`prosemirror-view`, `@xmldom/xmldom` (D3). The rest are transitive under `next` (`postcss` 8.4.31, `sharp`, `nanoid`) and build-time
(`brace-expansion`, `source-map-js`): fixed by the `next` upgrade or not reachable at runtime. New since the 2026-07-25 note (which
listed only `sharp`/`postcss` under `next`): every advisory above; the 2026-10-21 audit recorded no npm run.

## Ranked fix list

| # | Item | Effort |
|---|------|--------|
| 1 | D1: `next` to 16.4.2, build and smoke the PDF routes | S |
| 2 | M1: `fetchPublic` header allow-list on cross-origin hops, no https→http, honour `redirect: "error"`; SAP and webhooks no cross-origin redirects | S |
| 3 | D2: `nodemailer` to latest 10.x (>10.0.5), retest mail-server connector send and mailbox poll | M |
| 4 | M2: admin-only write policies on the three Business Role tables + `rlsPolicies.test.ts` entries | M |
| 5 | L1: refuse credential query names in webhook URLs; log host only in change history | S |
| 6 | D3: tiptap/prosemirror `npm audit fix`; mammoth/xmldom bump or size cap | S |
| 7 | L4: bounded reads in webhook sender and SAP client | S |
| 8 | L2 + L3: `cronSecretOk` and the middleware flag check in the SAP cron | XS |
| 9 | L5: hourly prune (or hide payloads older than 48 h) | XS |

## Could not verify from source

- Whether 0199/0200/0202/0203/0204 are applied on dev and production, and live RLS on the Business Role tables (M2).
- Whether any tenant has a webhook URL with an embedded credential (decides L1's real exposure) or a receiver that redirects (M1).
- DNS rebinding between the host check and the connect (unchanged residual from 2026-10-21).
