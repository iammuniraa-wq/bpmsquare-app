# Webhooks library: one place where every webhook is created and kept

Spec 2026-10-21. Owner: "Check the webhooks part like what is there in Marketo, I like it
and it deserves a separate section where all webhooks can be created and stored. Separate
webhooks inside the connector is not useful." Marketo model: Admin > Webhooks; a definition
has a name, URL, request type, payload template with tokens, custom headers, response
handling; flows later call a webhook by picking it from the list.

## Decisions (taken, apply as defaults)
1. Top-level **Settings > Integrations > Webhooks** (`settingsMenu.ts`, group integrations,
   adminOnly, `featureKey: "webhooks_library"`).
2. Round 1 = the library. **One list, two kinds:** **Event** (the change feed, today's
   dispatcher) and **Call** (fired by something). Call webhooks are fired from: a Standard
   Quote awarded (the middleware Links row can pick a webhook as its target), a record button
   (replaces the account "Push to ERP"), and Coverage routes. Every call is a Monitor row.
   Test with a sample record. NOT round 1: a Journey step, response-to-field write-back (the
   response is kept in the Monitor payload only).
3. The `integration_push` URL and the Coverage endpoints are **migrated into the library by
   SQL, idempotently, nothing lost**; with the flag on the old fields become read-only
   pointers and leave the UI.
4. Platform-admin flag **`webhooks_library`** (TenantFeatures, TenantEditor FEATURES,
   NewTenantForm default off). Unflagged tenants (Vikas, BIM) keep today's Webhooks & push
   page and see nothing new: no menu item, no route, no new query on their paths.
5. Secrets sealed (`sealSecret`): header values and the signing secret are write-only after
   save (replace, never reveal); GET returns `"set"`.
6. Slack's incoming-webhook URL **stays a connector field**: it is a third-party credential
   for notifications, not a webhook the tenant defines (`connectors/registry.ts` untouched).

## Data

### Extend `webhooks`, do not add a table
Recommendation: **extend the existing `webhooks` table (0082) with a `kind` column** rather
than a new `webhook_definitions`. Reasons: it is already service-role only (0199) and already
asserted by `rlsPolicies.test.ts`; `webhook_deliveries`, the dispatcher, the cron and the
Monitor's name lookup all reference it by FK and id; "one list holding two kinds" is then one
query, and the old page keeps working on the same rows. A second table would mean copying
rows, rewriting the FK and two code paths for one screen.

Event kind keeps the cursor semantics unchanged (`cursor_ts`, `cursor_id`, `object_types`,
`failure_count`, auto-pause). Call kind leaves the cursor null and is never drained by the cron.

**Migration `supabase/migrations/0202_webhooks_library.sql`** (next after 0201; owner runs by
hand; bundle `scripts/run-bundle-11-webhooks-2026-10-21.sql` = 0202 then
`scripts/seed-webhooks-demo.sql`, which flips `webhooks_library` on for `is_demo` tenants
only). Additive, idempotent, every block guarded with `to_regclass`.

```sql
alter table webhooks
  add column if not exists kind text not null default 'event' check (kind in ('event','call')),
  add column if not exists object_type text,                 -- call: the one object it accepts
  add column if not exists method text not null default 'POST' check (method in ('GET','POST','PUT','PATCH')),
  add column if not exists headers jsonb not null default '[]'::jsonb,   -- [{name, value}] value sealed
  add column if not exists payload_mode text not null default 'standard' check (payload_mode in ('standard','template')),
  add column if not exists template text,                    -- <= 16 KB, JSON with tokens
  add column if not exists allow_personal_data boolean not null default false,
  add column if not exists timeout_ms integer not null default 15000 check (timeout_ms between 5000 and 30000),
  add column if not exists paused_reason text,
  add column if not exists legacy_key text,                  -- idempotent import marker
  add column if not exists updated_at timestamptz;
create index if not exists webhooks_tenant_kind_idx on webhooks (tenant_id, kind);
create unique index if not exists webhooks_legacy_key_idx on webhooks (tenant_id, legacy_key) where legacy_key is not null;
-- references
alter table coverages add column if not exists webhook_id uuid references webhooks(id) on delete set null;
alter table integration_messages add column if not exists webhook_id uuid;
create index if not exists integration_messages_webhook_idx on integration_messages (tenant_id, webhook_id, created_at desc) where webhook_id is not null;
```

RLS: `webhooks` keeps **no policy at all** (service role only; the 2026-10-21 lesson: a
member must never write a row that holds a credential or steers where the server posts).
`rlsPolicies.test.ts` already asserts this and will fail the build if 0202 adds one; add one
line to its "replay understands" test naming 0202. `webhook_deliveries` keeps member read.
No column is added to `tenants`, so `tenantsColumnGrants.test.ts` is unaffected (said here
so nobody looks for the grant).

**Data migration in the same file** (pure SQL, idempotent through `legacy_key`, `on conflict
do nothing`): for every tenant with `config->'integration_push'->>'webhook_url'` insert a
Call webhook (`name` "ERP push", `object_type` accounts, `method` POST, `payload_mode`
standard, `allow_personal_data` true, `secret` = the stored sealed string copied as-is,
`legacy_key` `integration_push:default`); for every `endpoints[]` entry one row (`legacy_key`
`integration_push:endpoint:<id>`, name = its name). Then
`update coverages set webhook_id = w.id from webhooks w where w.legacy_key =
'integration_push:endpoint:' || coverages.erp_endpoint_id and w.tenant_id = coverages.tenant_id
and coverages.webhook_id is null`. Secrets stay readable because `unsealSecret` accepts both
the sealed form and legacy plaintext; the first save from the library seals a plaintext one.
`config.integration_push` and `coverages.erp_endpoint_id` are **not removed** (the unflagged
page still reads them); with the flag on the code reads only the library. `allow_personal_data`
is true on migrated rows because today's push sends the decrypted account: nothing lost.

A migrated `http://` URL (the old route allowed it) is kept but marked **needs attention**
("The address must use https") and does not fire until edited. New and edited URLs are https
only.

**References by id, tenant-verified:** `coverages.webhook_id`,
`config.integration_middleware.documents.quote.webhook_id` (Links target) and
`config.webhooks_library.record_buttons.accounts` (the record button) all hold a webhook id.
Every write route resolves it with `.eq("id", x).eq("tenant_id", tenantId).eq("kind","call")
.eq("object_type", <expected>).maybeSingle()` before storing; a miss is 422.

**Degrade while pending:** every library route answers `{ needsDatabaseUpdate: true, bundle }`
on 42P01/42703/PGRST204/PGRST205 (`isSchemaPending`), the page shows "Database update needed:
run <bundle>", the sender records nothing and returns a plain failure. The cron selects `kind`
and filters `kind = 'event'`; on 42703 it retries with today's select (no Call row can exist
before the migration, because the routes that create one are behind the flag the seed sets
after it).

## A definition (fields and rules)

| Field | Rule |
|---|---|
| name | 1–80 chars, unique per tenant (422 otherwise) |
| kind | `event` or `call`; fixed after create |
| object_type (call) | one of `accounts`, `standard_quotes` (the token whitelist depends on it); more objects later by adding a loader + whitelist |
| object_types (event) | as today (`SUBSCRIBABLE_OBJECTS` or `*`) |
| url | https only; `assertSafeHttpsUrl` on save (DNS resolved, private ranges refused), `fetchPublic` at send (re-checked per hop, redirects refused). Tokens allowed in path and query, URL-encoded; **PII tokens never in a URL** (422) |
| method | GET, POST, PUT, PATCH. GET and DELETE send no body; the signature then covers the empty string |
| headers | max 10; name `^[A-Za-z0-9-]{1,64}$`, not `host`/`content-length`/the `X-BPMSquare-*` family; value ≤ 1024, sealed, write-only. Save: omit = remove, `""` = unchanged, text = replace |
| payload_mode | `standard` = signed JSON `{ event, delivery_id, sent_at, workspace, record }`, the record as the v1 whitelist (`LIST_SOURCES`) of that object, PII fields only when `allow_personal_data`; `template` = the tenant's JSON with tokens |
| template | ≤ 16 KB; must parse as JSON **before** substitution (tokens live inside string values); unknown token = 422 naming it; PII token without `allow_personal_data` = 422 |
| allow_personal_data | default off; migrated rows on |
| timeout_ms | 5–30 s, default 15 |
| active / paused_reason | on/off switch; auto-pause after **15** consecutive failures (the existing `MAX_FAILURES`; the prompt's "5" is not what the code does); Resume resets the counter |
| secret | `whsec_…` generated on create, sealed, "Regenerate" only |
| Used by | computed, not stored: Links, Coverage rows, record button |

**Token grammar.** `{{alias.field}}`, closed whitelist per object type in
`src/lib/webhooks/tokens.ts` (pure, tested). System tokens for every object: `{{event}}`,
`{{sent_at}}`, `{{delivery_id}}`, `{{workspace.name}}`, `{{record.id}}`, `{{record.url}}`.
Object tokens, examples: accounts `{{account.ref}}`, `{{account.name}}`, `{{account.city}}`,
`{{account.email}}`(pii), `{{account.phone}}`(pii), `{{account.gstin}}`(pii),
`{{account.custom.<cf_key>}}`; standard_quotes `{{quote.ref}}`, `{{quote.status}}`,
`{{quote.currency}}`, `{{quote.total}}`, `{{quote.lines}}` (array), `{{account.*}}` of its
account, `{{quote.external.<system>}}` (the ERP number from `connector_links`). Substitution:
a string value holding text plus tokens becomes text (values stringified, nulls empty); a
string that is **exactly one token** becomes that token's JSON value (number, array, object,
boolean, null), which is how `"lines": "{{quote.lines}}"` emits an array. No expressions, no
loops, no code; a body over 256 KB after rendering fails with "The payload is too large".
PII tokens decrypt only when whitelisted AND `allow_personal_data` is on; cost/margin fields
(`products.cost_price`, internal cost breakdown) are not in any whitelist.

**Headers sent** (compat with today's receivers): `Content-Type: application/json`,
`X-BPMSquare-Signature` (hex HMAC-SHA256 of the raw body with the secret),
`X-BPMSquare-Delivery` (uuid per attempt), `X-BPMSquare-Event`, `X-BPMSquare-Timestamp`,
`X-BPMSquare-Idempotency-Key` (`sha256(webhook_id|object_id|event|first message id)`, stable
across retries so a receiver can de-duplicate), then the tenant's own headers (a tenant header
cannot override the `X-BPMSquare-*` ones).

## Firing

**One sender, `src/lib/webhooks/sender.ts`:**
`fireWebhook(admin, { tenantId, webhookId, objectType, objectId, event, trigger:
"award"|"button"|"coverage"|"test"|"retry", userId?, retryOf? })` →
load the definition (tenant-verified, kind call, active, matching object_type) → load the
record through the object loader (`loaders.ts`: accounts via `decryptAccount`, standard quotes
with lines and account) → render (standard or template) → sign → `fetchPublic` with the
timeout → one automatic retry after 2 s on network error, 429 or 5xx (never on 4xx) →
`recordMessage` (channel `webhook`, `webhook_id`, `entity` = object_type, `ref_label`,
`summary { kind: "webhook_call", webhook: name, trigger, headline, fix }`, `exchange` built
with `buildExchangePayload` so request and response are redacted by `redactPayload`,
size-capped and pruned at 48 h like every middleware payload) → update `last_delivery_at`,
`last_status`, `last_error`, `failure_count`, auto-pause → return
`{ ok, status, messageId, durationMs, headline, fix }`. Never throws into a caller; a demo
workspace records `redirected` and sends nothing (same posture as mail).

**Quote awarded.** `TARGET_KINDS` gains `"webhook"`; `DocumentConfig` gains `webhook_id`;
`targetOptions()` adds `{ key: "webhook", label: "Webhook" }` (available when the tenant has an
active Call webhook for standard_quotes, hint "Create one under Settings > Webhooks"
otherwise); the Links panel shows a second dropdown "Which webhook" for that target. In
`dispatchQuoteOutcome`, **before** `loadD365`, `if (prep.target === "webhook")` →
`sendViaWebhook`: same claim on `connector_links` with `connector_id = "webhook:<id>"`,
`entity standard_quotes`, placeholder `pending:<uuid>` replaced by the delivery id on 2xx (so
Send now, auto and Restart never fire twice); `external_key` stays null in round 1 (response
mapping later). The Dynamics and SAP paths are untouched. Rejected still never leaves.

**Record button.** `config.webhooks_library.record_buttons.accounts` names the webhook; the
account page gets "Send to <webhook name>" in the header overflow (`AccountSendButton.tsx`,
flag-gated, replaces the unmounted `AccountPushButton`), calling
`POST /api/accounts/[id]/push`, which with the flag on resolves Coverage first
(`coverages.webhook_id`) then the record button's webhook and calls `fireWebhook` (trigger
`button`); with the flag off the route behaves exactly as today. The middleware "Send a record"
(`ops.sendRecord`) calls the same function.

**Coverage.** `resolveErpEndpointForAccount` returns `{ webhook_id }` when the flag is on
(reads `coverages.webhook_id`, falls back to the record-button webhook); the Coverage screen's
endpoint box becomes a picker of Call webhooks for accounts ("Managed in Settings > Webhooks").

**Domain events.** The award path is the existing `quote.awarded` emit → `dispatchQuoteOutcome`;
no new event bus work. `fireWebhook` emits nothing (loop guard: webhooks are leaves).

**Failure and Restart.** A failed call is a `failed` Monitor row with `restartable: true`;
`classifyIntegrationRow` returns `"webhook_call"` for `summary.kind`, and `restartMessages`
calls `fireWebhook` with `trigger: "retry", retryOf: row.id` (same idempotency key). View
request / View response work as for documents. A paused webhook shows "Paused after 15
failures" on the row and in the fix line; Resume is in the panel.

## Screen: Settings > Webhooks (6b rules)
Admin only (server: `_guard.ts` = `requireTenantUser` + role admin + flag → 404). One list,
one panel. Explanations in `tips.ts` behind InfoTips; no running text.

```
Webhooks (i)                                            [ New webhook ]
┌──────────────────────────────────────────────────────────────────────┐
│ ● Call   ERP push            POST erp.acme.com   Today 14:02 OK   2 uses │
│ ● Event  Data warehouse      POST hooks.dw.io    Today 09:10 OK         │
│ ○ Call   Legacy endpoint     http://…  Needs attention · Not https      │
│ ◐ Event  Old BI feed         Paused after 15 failures   Resume          │
└──────────────────────────────────────────────────────────────────────┘
Row click → side panel (bottom sheet < 780 px), tabs via useUrlTab:
  Basics  | Request | Security | Test | Log                  [ Save ]
  Basics: name · kind (locked) · object · On/Off · "Button on Accounts" (call+accounts)
  Request: URL · method · headers (name, "set", Replace) · payload (Standard | Template
           with token picker chips, Allow personal data) · timeout
  Security: signing secret "set" · Regenerate · the header names sent
  Test: pick a sample record (10 most recent) · Preview (request) · Send test (request + response)
  Log: last 20 (time, status, duration, headline) · "Open in Monitor"
```
Row = kind chip, name, method + host, state dot (On / Off / Paused / Needs attention), last
call, Used-by chip (opens a small list: "Links: Quote", "Coverage: EU team", "Button:
Accounts"). Delete is refused (409) while used, naming the user. Event rows: Request shows URL
only ("Change feed, signed"), Test sends the ping. Empty state: "No webhooks yet" + New
webhook. 375 px: rows stack (chip + name; host + state), tabs scroll horizontally, Save in the
sticky footer, tap targets ≥ 44 px, no horizontal scroll. Tips in
`src/app/(app)/settings/webhooks/tips.ts` held by `tips.test.ts` with `tipTextProblems`.
`/settings/push` redirects to `/settings/webhooks` when the flag is on; the "push" menu entry
gains `hiddenWhenFeature: "webhooks_library"` (one optional field on `SettingsMenuEntry`).

## Every-surface checklist (bpmsquarecore 3b)
- Feature flag: `webhooks_library` in `TenantFeatures`, `TenantEditor` FEATURES ("Platform &
  automation"), `NewTenantForm` DEFAULT off. ✔
- Settings menu entry + `ROUTES.settingsWebhooks`; page uses `requireFeature`. ✔ No `NAV` item
  (a settings page), no workcenter (admin-only, like API keys).
- Change history: `logChange` on create / update / delete / regenerate / pause with
  `objectType "webhooks"`, diff excluding secret and header values; `{ value: "webhooks",
  label: "Webhooks" }` in `ChangeHistoryClient` OBJECT_TYPES. ✔
- Monitor: rows land in `integration_messages` (channel webhook) and show in the middleware
  Monitor with Restart and payload view; `SQL_BUNDLES.webhooks` names the bundle. ✔
- v1 API: **no** in round 1. It is an admin configuration surface holding credentials, the
  same posture as `api_keys` (no v1 endpoint); a key with `objects:["*"]` must not be able to
  read or repoint where the server posts. Revisit with scopes if a customer asks.
- MCP: no. Data Workbench: no (not business data). Global search: no. Analytics: no. Nova
  timeline / ⌘K create action: no (settings page; the settings search finds it).
- `OBJECT_FEATURE`: not needed (no v1, DW or import route); `objectFeatures.test.ts` stays green.
- Docs: Admin & Setup Guide (new Webhooks section, Coverage endpoint picker) and the REST API
  guide (signature headers, idempotency key) — **after the owner validates, not now**.

## Security
- SSRF: save → `assertSafeHttpsUrl`; send → `fetchPublic` (host re-resolved, every redirect
  hop checked, redirects refused). Migrated http rows do not fire.
- Secrets: sealed with `sealSecret`, unsealed only inside the sender; never in GET bodies, logs,
  the Monitor (`redactPayload` strips `authorization`, `signature`, `secret`, `token` keys and
  the stored request omits headers entirely), change-log diffs or client bundles.
- Tokens: closed whitelist per object; PII decrypts only when whitelisted and allowed; never in
  URLs; no code execution (JSON-first substitution); template 16 KB, body 256 KB, 10 headers,
  timeout 30 s max, one automatic retry, 15-failure pause.
- Who may create: admin only, server-side, flag-gated (404 without the flag).
- Cross-tenant ids: every stored webhook id (Links, Coverage, record button) is verified
  against `tenant_id` and `kind`/`object_type` at write time and again at fire time; a foreign
  id fires nothing and records "not found".
- Replay / idempotency: delivery id per attempt, idempotency key per firing, claim row for the
  award path; `X-BPMSquare-Timestamp` lets receivers reject old signatures.
- Tests: `rlsPolicies.test.ts` (0202 adds no policy); `tokens.test.ts` (whitelist, PII gate,
  bare-token JSON emit, nested tokens, unknown token, oversize, invalid JSON, token in URL
  encoding, PII-in-URL refusal); `render.test.ts` fuzz: random strings with `{{`, `}}`, quotes,
  backslashes, unicode must always yield valid JSON or a 422; `sender.test.ts` with a fake fetch
  (2xx, 4xx no retry, 5xx one retry, timeout, auto-pause at 15, paused skips, demo redirected,
  message row shape, secret absent from stored payload); SSRF cases through `fetchPublic`
  (private v4/v6, redirect to private, http on a migrated row); `migration.test.ts` replays
  0202 on a fake row set twice and expects one row per legacy key.

## Build plan: two work packages, parallel in worktrees

**WP-A "Webhooks backend"** — `supabase/migrations/0202_webhooks_library.sql`,
`scripts/seed-webhooks-demo.sql`, `scripts/run-bundle-11-webhooks-2026-10-21.sql`;
`src/lib/constants.ts` (flag, `ROUTES.settingsWebhooks`, `config.webhooks_library` type);
`src/lib/webhooks/{tokens,render,loaders,sender,library}.ts` + tests; `src/lib/webhooks/dispatch.ts`
(kind filter in cron select, secret via `unsealSecret`); `src/app/api/webhooks/cron/route.ts`;
`src/app/api/settings/webhooks-library/_guard.ts`, `route.ts`, `[id]/route.ts`,
`[id]/test/route.ts`, `[id]/preview/route.ts`, `[id]/deliveries/route.ts`, `tokens/route.ts`,
`samples/route.ts`; `src/lib/middleware/{types,contract,documents,dispatch,restart,monitorRows}.ts`
(webhook target, classify, restart); `src/lib/accountPush.ts`, `src/lib/coverage/resolve.ts`,
`src/app/api/accounts/[id]/push/route.ts`, `src/app/api/settings/coverage/**` (webhook_id
accepted + verified); `src/lib/middleware/ops.ts` (sendRecord); `src/lib/rlsPolicies.test.ts`;
`ChangeHistoryClient.tsx` OBJECT_TYPES; `PROJECT.md` ledger line (0202 pending on both DBs,
seed after). Admin: `TenantEditor.tsx`, `NewTenantForm.tsx`.

**WP-B "Webhooks UI"** — `src/app/(app)/settings/webhooks/{page.tsx, WebhooksClient.tsx,
WebhookPanel.tsx, TokenPicker.tsx, api.ts, logic.ts, tips.ts, tips.test.ts, logic.test.ts,
webhooks.module.css}`; `src/components/ui/SidePanel.tsx` (generalised copy of the middleware
`Panel.tsx`; the middleware page keeps its own until the owner validates, then dedupe);
`src/lib/settingsMenu.ts` (entry + `hiddenWhenFeature`); `src/app/(app)/settings/push/page.tsx`
(redirect when flag on); `src/app/(app)/settings/middleware/LinksTab.tsx` + `linksLogic.ts`
("Which webhook" dropdown); `CoverageSettingsClient.tsx` (endpoint picker);
`src/app/(app)/accounts/[id]/AccountSendButton.tsx`. Until WP-A lands, WP-B runs on a fixture
of the contract below (`api.ts` has a `MOCK` switch removed before merge).

**Contract (WP-A builds, WP-B consumes; every route admin + flag, else 404; pending schema →
`{ needsDatabaseUpdate: true, bundle }` with 200):**
- `GET /api/settings/webhooks-library` → `{ webhooks: Webhook[], recordButtons: { accounts:
  string|null }, objects: [{ key, label }], needsDatabaseUpdate, bundle }`.
  `Webhook = { id, kind:"event"|"call", name, url, method, object_type|null, object_types,
  headers:[{ name, set:true }], payload_mode, template|null, allow_personal_data, timeout_ms,
  active, paused_reason|null, secret:"set", last_delivery_at, last_status, last_error,
  failure_count, needs_attention: string|null, used_by:[{ kind:"link"|"coverage"|"button",
  label }], created_at, updated_at }`.
- `POST /api/settings/webhooks-library` with `{ kind, name, url, method?, object_type?,
  object_types?, headers?:[{name,value}], payload_mode?, template?, allow_personal_data?,
  timeout_ms?, button_on?: "accounts"|null }` → `{ webhook }` 201; 422 `{ errors:[{field,
  message}] }`.
- `PATCH /api/settings/webhooks-library/[id]` same fields partial (`headers` full-list replace,
  `value:""` keeps), plus `{ active }`, `{ regenerate_secret:true }` → `{ webhook }`.
- `DELETE …/[id]` → `{ deleted:true }` or 409 `{ error, used_by }`.
- `GET …/tokens?object_type=` → `{ tokens:[{ token, label, pii, kind:"text"|"number"|
  "array"|"object" }] }`.
- `GET …/samples?object_type=` → `{ records:[{ id, label }] }` (10 newest, tenant-scoped).
- `POST …/[id]/preview` `{ object_id }` → `{ request:{ method, url, headers:[names], body } }`.
- `POST …/[id]/test` `{ object_id }` → `{ ok, status, durationMs, request, response:{ status,
  body }, messageId, headline, fix }` (trigger `test`, recorded in the Monitor).
- `GET …/[id]/deliveries` → `{ items:[{ id, at, status, http_status, duration_ms, headline,
  monitorId }] }` (call: `integration_messages` by `webhook_id`; event: `webhook_deliveries`).
- Middleware: `GET /api/middleware/documents` gains `targets[{key:"webhook"}]` and
  `webhooks:[{ id, name }]`; `PUT /api/middleware/documents/quote` accepts `{ target:"webhook",
  webhook_id }`. Coverage: `POST/PATCH /api/settings/coverage/assignments` accepts `webhook_id`.

**Verification order:** 1 `npx vitest run src/lib/webhooks src/lib/rlsPolicies.test.ts
src/lib/middleware` → 2 `npx tsc --noEmit` → 3 `npx next build` → 4 apply bundle 11 on dev,
seed demo → 5 on the demo tenant: create a Call webhook against a request-bin, Test with a
sample account, Preview, Send test; award a Standard Quote with the Links target = webhook and
see one Monitor row with request and response; kill the bin, award again, see failed +
Restart; Coverage route picks a webhook; migrated "ERP push" row present with "2 uses"; an
unflagged tenant shows the old page unchanged → 6 375 px pass on list, panel, Test tab → 7
security pass: a `http://`, a `https://10.0.0.1`, a redirect to `169.254.169.254`, a PII token
in the URL, a template with `{{account.email}}` and personal data off — all refused with a
plain message.

**Acceptance:** one list, two kinds; migrated rows present on first open; nothing visible on
an unflagged tenant; secrets never readable after save; every call in the Monitor with
Restart; `tsc`, `next build`, all tests clean; no push until the owner validates.

## Decisions still open for the owner (recommendation in brackets)
1. **Where the record button sits on the account page**: a visible "Send to <webhook>" button
   in the header, or an entry in the header overflow menu. [Overflow: the button was taken off
   the header on 2026-08-19 as clutter; the menu keeps the page clean and the action one tap.]
2. **Migrated `http://` URLs**: refuse to fire until edited to https (this spec), or allow http
   for migrated rows only. [Refuse: decision 5 says https only, and the fix is one edit.]

## Later (hook points stated, not built)
- **Journey "Call webhook" step**: `src/lib/studio` already knows a change kind `integration`
  with a connector; a journey step `{ kind: "webhook", webhook_id }` would call `fireWebhook`
  with trigger `journey`, loop-guarded by the event depth. Round 2.
- **Response mapping**: `response_map jsonb` on the definition (`[{ path, field }]`), applied
  by the sender to the record through the object's PATCH allowlist; the response is already
  kept in the Monitor payload so the shape is known. Round 2.
- **v1 API / Nova**: read-only `GET /api/v1/webhooks` behind an explicit scope, and a Nova
  tool "did the webhook for SQ-0012 go out?" reading the Monitor. After validation.
- **More objects** (contacts, invoices, work orders): a loader + whitelist each.
- Slack stays a connector field (decision 6).
