# Microsoft Dynamics 365 connector

> Reviewed and hardened 2026-10-19 (`docs/d365-connector-review.md`). Built 2026-10-15 (owner request: "create a D365 connector to connect to
> master data and fence projects and whatever is possible; a standard
> connector for Dynamics with multiple login types — OAuth, basic or
> certificate — build robust"). Migration **0129_connector_sync.sql**
> pending, plus **0136_connector_run_lock.sql** (optional: makes the
> one-run-at-a-time lock atomic). **Not yet exercised against a live Dynamics environment** — the
> code is unit-tested against Microsoft's documented API shapes; the first
> real connection should be made on the demo tenant with Preview before any
> Sync.

## What it does

| Entity | Direction | BPMSquare object | Default source (F&O · Dataverse · Business Central) |
|---|---|---|---|
| Customers | pull | Accounts | `CustomersV3` · `accounts` · `customers` |
| Contacts | pull | Contacts (linked to a synced customer) | off · `contacts` · off |
| Vendors | pull | Suppliers | `VendorsV2` · off (accounts typed vendor) · `vendors` |
| Products | pull | Products | `ReleasedProductsV2` · `products` · `items` |
| Projects | pull | Workforce projects | off · off (`msdyn_projects`) · off (`projects`) |
| Fence projects | push | creates a project in Dynamics | off (needs your contract/group) · `msdyn_projects` · `projects` |

- **Pull** creates new records and, on later runs, updates only the mapped
  fields of records it created (found through `connector_links` by the
  Dynamics id — never by name). It never deletes anything, never touches a
  field outside the map, and a blank in Dynamics never wipes a value here.
  Unchanged rows are skipped by content fingerprint. How a run continues
  is described under "How a pull continues" below.
- **Push** sends each *won* fence project once (tracked in
  `connector_links`), binding its customer when that account came from
  Dynamics.
- Every created/updated record gets a change-history entry; every run is in
  `connector_sync_runs` with counts and the first 25 row-level notes.

## Login types

| Login type | Products | What's stored (encrypted) |
|---|---|---|
| OAuth 2.0 client credentials + **client secret** | all | client secret |
| OAuth 2.0 client credentials + **certificate** | all | certificate + private key; a signed client assertion (PS256, x5t#S256 + x5t, 5-minute life) is sent instead of a secret |
| OAuth 2.0 **sign in as a user** (authorization code) | all | client secret (or certificate) + refresh token |
| **Basic** (username + password / web service key) | Business Central on-premises only — Microsoft retired basic auth for every online API | password |

Tokens are cached encrypted on the connector row with their expiry and
refreshed two minutes early; never held in process memory.

## Setup (customer side)

1. **Register an app** in Microsoft Entra ID; note the directory (tenant) id
   and application (client) id. Add a client secret or upload a certificate.
2. Give it access:
   - *Dataverse*: Power Platform admin center → environment → Application
     users → add the app with a security role that can read the entities.
   - *Finance & Operations*: System administration → Microsoft Entra
     applications → add the client id mapped to a user.
   - *Business Central*: grant API permission `API.ReadWrite.All`
     (application), then add the app under *Microsoft Entra Applications* in
     BC and grant it permission sets.
   - *Sign in as a user*: also add the redirect URI
     `https://<your BPMSquare address>/api/connectors/dynamics365/oauth/callback`
     (the settings screen shows it in full) and the **delegated** API
     permission — Dataverse: Dynamics CRM `user_impersonation`; F&O: Dynamics
     ERP `Odata.FullAccess`; Business Central: `Financials.ReadWrite.All`.
     The sign-in uses PKCE (S256); the verifier lives in an httpOnly cookie
     sent only to the callback, so a code can only be redeemed by the browser
     that started the sign-in.
3. In BPMSquare: **Settings → Connectors → Microsoft Dynamics 365 → Set up**.
   Choose product and login type, fill the fields, **Save**, **Test
   connection**. For Business Central, Test lists the companies; paste the
   company id and save again.
4. For each entity press **Preview** to see the real field names, adjust the
   map if your environment is customised, **Save**, then **Sync now**.
   Sync Customers before Contacts and Projects (they link to customers).
5. Optionally turn on **Automatic sync** (hourly or daily at 02:00 UTC).

## How a pull continues

- **Entity with a modified-on field** (Dataverse `modifiedon`, BC
  `lastModifiedDateTime`): rows are read in ascending order with
  `modifiedon ge <watermark>`. The watermark never moves past the first row a
  run could not apply (a failure, or a contact whose customer isn't synced
  yet), so that row is read again next run instead of waiting until it
  changes in Dynamics; rows already applied come back as "unchanged" through
  their fingerprint. If a capped or timed-out run would not advance at all
  (a row that can never be applied), the watermark moves on and the run's
  notes say the row is only retried when it changes or on a full sync.
- **Entity without one** (all Finance & Operations entities): rows are read in
  id order from a cursor (`k|<company>|<last id>` in the run's watermark) up
  to 5,000 per run. The run that reaches the end stores an empty id, so the
  next run starts again from the top — that is how changes are found when
  there is nothing to ask "changed since", and it also retries any row that
  failed. A big table therefore takes several runs per pass. Changing the
  company on the connector, or **Start over**, restarts the scan.
- **Only the mapped columns are requested** (`$select`: mapped sources, id,
  key, modified field, and `dataAreaId` on F&O). A wrong field name in a map
  therefore fails the run with Dynamics's own message instead of silently
  syncing blanks. A source with a dotted path reads every column, as before.
- A new record whose link cannot be saved is removed again and counted
  failed, so a re-run can never create a twin.

### Finance & Operations companies

F&O account/vendor/project numbers are unique only inside a legal entity, so
links are stored as `<dataAreaId>|<number>` (`usmf|C0100`). Links written
before this change hold the bare number; they are **not rewritten in bulk**.
The pull looks the company-scoped id up first and the bare one second; a bare
link is adopted by the first company whose row matches it and re-keyed to the
scoped form at that moment (one link at a time, as its row is read), after
which another company's identical number gets its own record. If an
environment was already synced from two companies before this change, the
bare links belong to whichever company's row was read first — check Accounts for
mixed-up customers before relying on it. Pushes to F&O send the bare account
number and `dataAreaId` (the connector's company, else the customer's).

### Runs

One run per entity at a time: a manual sync while the cron is on the same
entity answers "already running". A run stops starting new rows after 240 s
(265 s from the cron's start) and says the next run continues; a run left
`running` for over 10 minutes (function killed) is closed on the next start.
Migration 0136 adds a partial unique index so the lock is atomic; without it
the check still works for runs that are not started in the same instant. The
hourly cron rotates which tenant goes first.

## Safety

- The environment URL is typed by the tenant and fetched by our server:
  online products must be on Microsoft's Dynamics domains, every host must
  resolve to public addresses (`src/lib/net/safeHost.ts`), redirects are
  refused, and `@odata.nextLink` is only followed on the same host (so the
  bearer token can never be sent elsewhere).
- 429/503/504 are retried honouring `Retry-After`; every request has a
  30 s timeout.
- Admin-only: every route requires the workspace admin role; secrets are
  write-only (the screen shows "stored", never the value).
- All writes run on the service-role client with explicit `tenant_id`
  filters; `connector_links` / `connector_sync_runs` are select-only under
  RLS.

## Code

- `src/lib/connectors/d365/` — `types.ts`, `catalog.ts` (defaults, URLs,
  host rules), `jwt.ts` (certificate assertion), `mapping.ts` (pure
  transforms), `odata.ts` (client: retries, paging, same-origin links),
  `server.ts` (config, tokens, test, preview, pull, push), `pkce.ts`; tests in
  `d365.test.ts`, `sync.test.ts`, `syncPull.test.ts`, `oauth.test.ts`
  (`syncHarness.ts` is their in-memory Supabase + scripted fetch).
- Routes `src/app/api/connectors/dynamics365/**`, cron
  `/api/connectors/cron/dynamics365` (hourly, `vercel.json`).
- Screen `src/app/(app)/settings/connectors/dynamics365/`.

## Not built yet

- Writing master data back to Dynamics (accounts/products are pull-only).
- Quotes/orders to Dynamics, invoices from Dynamics.
- Sovereign clouds (GCC/China authority hosts) — the login host is the
  global `login.microsoftonline.com`.
- An encrypted (password-protected) private key; upload it unencrypted.
