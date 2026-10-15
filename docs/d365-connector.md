# Microsoft Dynamics 365 connector

> Built 2026-10-15 (owner request: "create a D365 connector to connect to
> master data and fence projects and whatever is possible; a standard
> connector for Dynamics with multiple login types — OAuth, basic or
> certificate — build robust"). Migration **0129_connector_sync.sql**
> pending. **Not yet exercised against a live Dynamics environment** — the
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
  Unchanged rows are skipped by content fingerprint. Incremental where the
  entity has a modified-on field (Dataverse `modifiedon`, BC
  `lastModifiedDateTime`); F&O entities re-read in full (bounded at 5,000
  rows per run, continuing next run).
- **Push** sends each *won* fence project once (tracked in
  `connector_links`), binding its customer when that account came from
  Dynamics.
- Every created/updated record gets a change-history entry; every run is in
  `connector_sync_runs` with counts and the first 25 row-level notes.

## Login types

| Login type | Products | What's stored (encrypted) |
|---|---|---|
| OAuth 2.0 client credentials + **client secret** | all | client secret |
| OAuth 2.0 client credentials + **certificate** | all | certificate + private key; a signed client assertion (RS256, x5t + x5t#S256) is sent instead of a secret |
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
     `https://<your BPMSquare address>/api/connectors/dynamics365/oauth/callback`.
3. In BPMSquare: **Settings → Connectors → Microsoft Dynamics 365 → Set up**.
   Choose product and login type, fill the fields, **Save**, **Test
   connection**. For Business Central, Test lists the companies; paste the
   company id and save again.
4. For each entity press **Preview** to see the real field names, adjust the
   map if your environment is customised, **Save**, then **Sync now**.
   Sync Customers before Contacts and Projects (they link to customers).
5. Optionally turn on **Automatic sync** (hourly or daily at 02:00 UTC).

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
  `server.ts` (config, tokens, test, preview, pull, push); tests in
  `d365.test.ts`.
- Routes `src/app/api/connectors/dynamics365/**`, cron
  `/api/connectors/cron/dynamics365` (hourly, `vercel.json`).
- Screen `src/app/(app)/settings/connectors/dynamics365/`.

## Not built yet

- Writing master data back to Dynamics (accounts/products are pull-only).
- Quotes/orders to Dynamics, invoices from Dynamics.
- Sovereign clouds (GCC/China authority hosts) — the login host is the
  global `login.microsoftonline.com`.
- An encrypted (password-protected) private key; upload it unencrypted.
