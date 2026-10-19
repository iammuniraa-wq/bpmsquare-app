# Dynamics 365 connector — review (2026-10-19)

> Status: **in progress**. Review of the connector built 2026-10-15
> (`docs/d365-connector.md`), which has never run against a live Dynamics
> environment. Context: BPMSquare is the quoting front-end for a Saudi
> precast manufacturer implementing Dynamics 365 Finance & Operations
> (customers, released products, vendors in; won quotes, projects, BOMs out
> later). Checked against Microsoft Learn (sources at the end).

## Findings (ranked)

Status column: **fixed** (commit in this branch), **open** (remains, with the
reason), **doc** (documentation/checklist only).

### Critical

| # | Finding | Status |
|---|---|---|
| C1 | **F&O pulls never get past row 5,000.** F&O entities have no modified-on field, so every run re-reads from the top and stops at the 5,000-row cap; "continues next run" was false. Rows after 5,000 (by server order) never sync. | open → fixing (keyset cursor on the id field, stored as the run watermark) |
| C2 | **A failed link insert creates a twin every run.** After inserting the BPMSquare record, the `connector_links` insert result was not checked. If it fails (race with a concurrent run → unique violation, or any error), the record exists without a link and the next run creates it again. | open → fixing (check the error; on failure remove the just-created record and count the row failed) |

### High

| # | Finding | Status |
|---|---|---|
| H1 | **Vendor updates always fail.** The update path sets `updated_at` on every table except accounts/contacts, but `suppliers` has no `updated_at` column (0000_baseline) → every re-sync of a changed vendor is a row error. | **fixed** (bf0312d6) — suppliers excluded from `updated_at`; record building is a pure, tested helper |
| H2 | **Failed / deferred rows are lost forever on incremental pulls.** The watermark advances past rows that failed, and past contacts skipped because their customer wasn't synced yet. They are only retried if they change again in Dynamics. Also `gt` loses rows that share the last second when a run stops at the cap. | open → fixing (`ge` watermark, never advanced past the first failed/deferred row; fingerprint makes re-reads free) |
| H3 | **Non-idempotent POST retried.** A push (create project) was retried on timeout/503/504, when Dynamics may already have created the record → duplicate project in the ERP. | **fixed** (01947515) — POST retried on 429 only |
| H4 | **Dataverse push can create a record and then report failure.** Without `return=representation` honoured, Dataverse answers 204 + `OData-EntityId` header; the code only read the body, threw "didn't return the id", and never linked → duplicate on the next run. | **fixed** (01947515) — id read from `OData-EntityId` |
| H5 | **Unbounded runs.** A first sync of thousands of rows (each 2–4 DB round trips + master ref) exceeds the route's 300 s; the function is killed, the run row stays `running` forever, the watermark is never saved. No lock: a manual sync during the cron run of the same entity races (see C2). | open → fixing (time budget per run, stale-run cleanup, per-entity lock) |
| H6 | **F&O company / dataAreaId.** External id was the bare `CustomerAccount`; the same account number exists in several legal entities, so switching or adding a company would map records onto the wrong BPMSquare record. Pushes to F&O did not send `dataAreaId`, so they land in the app user's default company. | open → fixing (external id scoped by dataAreaId for F&O; push adds `dataAreaId`) |

### Medium

| # | Finding | Status |
|---|---|---|
| M1 | Certificate assertion signed **RS256**; Microsoft's current doc says `alg` should be **PS256** (PSS padding) with `x5t#S256`. Lifetime `nbf-60 … +600` is 11 min, doc says 5–10 min after `nbf`. | **fixed** (43c153e7) — PS256/PSS, `x5t#S256`, 5-minute life |
| M2 | Token request (`login.microsoftonline.com`) had **no timeout**; response body reads in the OData client were outside the timeout. | **fixed** (43c153e7 token request, 01947515 body read) — both inside a timeout |
| M3 | A revoked / expired cached access token (401) failed every run until its cached expiry (up to ~1 h). | **fixed** (01947515) — one refresh-and-retry on 401 |
| M4 | Preview relied on `Prefer: odata.maxpagesize=5`; if the server ignores it (F&O pages at up to 10,000) a "5-row" preview pulls a full page of a wide entity. Syncs fetched every column (CustomersV3 has hundreds). | open → fixing (`$top` on preview, `$select` of mapped fields on sync) |
| M5 | OAuth authorization-code flow had no **PKCE** and the state was not bound to the browser that started it (an admin could be made to complete another admin's sign-in). | open → fixing (PKCE S256, verifier in an httpOnly cookie scoped to the callback path) |
| M6 | **Push defaulted ON** for Dataverse and Business Central: turning on the hourly schedule would create projects in the customer's production ERP for every won fence project without an explicit opt-in. | **fixed** (5cc284dd) — push off by default for every product, pinned by a test |
| M7 | Sovereign hosts (`.dynamics.cn`, `.microsoftdynamics.us`, `.dynamics365.us`) passed the host check, but tokens come from the global authority, so they could only fail with a confusing sign-in error. | **fixed** (5cc284dd) — sovereign hosts get a clear "not supported yet" message |
| M8 | Cron always walked tenants in the same order; one big tenant exhausting the 250 s budget starves the rest every hour. | open → fixing (rotate start) |
| M9 | DNS-rebinding window for **BC on-premises (basic)** only: the host is resolved and checked, then `fetch` resolves again. Online products are pinned to Microsoft domains so are not affected. | open (needs a pinned-lookup transport; low exposure — on-prem BC is not the precast case) |

### Low

| # | Finding | Status |
|---|---|---|
| L1 | Certificate/private-key upload not cross-checked (key matches cert, cert not expired) — errors only surface at the first token request. | **fixed** (43c153e7) — key/cert pair, expiry, RSA and encryption checked at save |
| L2 | Settings: the redirect URI shown as a relative path; no hint about delegated permissions; Runs table hides "unchanged". | open → fixing |
| L3 | Contact defaults: F&O `ContactPersonsV2.AssociatedPartyNumber` is a *party* number, not the `CustomerAccount` the customers link on → contacts would all be skipped. Default is off; documented. | doc |
| L4 | Refresh-token concurrency: two simultaneous refreshes can race on the stored token. Entra keeps the previous refresh token valid for confidential clients, so low risk. | open |

### Confirmed correct

- Scopes: F&O and Dataverse use `<environment origin>/.default`; BC uses
  `https://api.businesscentral.dynamics.com/.default`; `offline_access` only
  on the delegated flow; refresh tokens are rotated (a new one returned is stored).
- BC online URL `…/v2.0/{directory}/{environment}/api/v2.0/companies({id})`;
  basic auth limited to BC on-premises.
- F&O cross-company syntax `?cross-company=true&$filter=dataAreaId eq 'xxxx'`
  matches Microsoft's documented form.
- Tenant isolation: every service-role query in `server.ts` and the routes
  carries `.eq("tenant_id", tenantId)` (or inserts it); tenant comes only from
  `requireTenantUser()`; the OAuth state is HMAC-signed and tenant-bound.
- Secrets are encrypted at rest and write-only (GET returns booleans only).
- `@odata.nextLink` followed only on the base URL's origin; redirects refused.

## Live-test checklist

_(to be completed)_

## Precast gap list and build order

_(to be completed)_

## Sources

- Entra certificate credentials: https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials
- F&O OData: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/odata
- F&O priority-based throttling: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/priority-based-throttling
- BC API v2.0 project: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_project
- BC API v2.0 contact: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_contact
- Released products V2 entity: https://github.com/MicrosoftDocs/Dynamics-365-Unified-Operations-Public/blob/main/articles/fin-ops-core/dev-itpro/data-entities/entity-released-products-v2-releasedproductv2.md
