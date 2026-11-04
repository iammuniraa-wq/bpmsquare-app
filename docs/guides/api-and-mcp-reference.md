# BPMSquare REST API and MCP reference

Snapshot 2026-11-04. For integration developers at a client workspace. Everything here was derived from the route code under `src/app/api/v1`, `src/lib/api/*`, `mcp-server/mcp.json` and the settings routes. Where something could not be confirmed from the code it is marked "(verify)". All company names, refs, ids and keys in the samples are fictional (Example Trading LLC, ACC-0007, `bpm_live_xxxxxxxx`).

## 1. Overview

### 1.1 Base URL

Every workspace is served on its own domain. Use that domain:

```
https://<your-workspace-domain>/api/v1
```

The key, not the host, decides which workspace the call belongs to; there is no tenant id in any path. `app.bpmsquare.com` is the shared demo sandbox only and must not be used for a client integration. The samples below use `BASE=https://bpm.example-trading.com/api/v1`.

All responses are JSON. CORS is open (`Access-Control-Allow-Origin: *`), `OPTIONS` pre-flight is answered on every route.

### 1.2 Authentication

Send a bearer token on every call:

```
Authorization: Bearer bpm_live_xxxxxxxx
```

Two kinds of key resolve to a workspace:

| Kind | How it is made | Access |
|---|---|---|
| Scoped key | Settings, API keys & developer, "Scoped API keys", "+ New key" (workspace admin only). Name, Read and/or Write, all objects or a named subset, optional expiry (must be a future date). The token is shown once and only its SHA-256 hash is stored. Revoke at any time. | Exactly the scope you chose. |
| Workspace key (legacy) | Settings, API keys & developer, "API Key", Generate / Regenerate (admin only). One plaintext key per workspace. | Read and write on every object except those that need explicit naming (section 1.3). |

Real scoped tokens look like `bpm_` followed by 48 hex characters (the list screen shows the first 12 characters). The samples use the placeholder `bpm_live_xxxxxxxx`. Treat a key like a password; regenerating the workspace key stops the old one immediately.

An expired or revoked key behaves as an unknown key (401).

### 1.3 Scopes

A scope is `{ read, write, objects }`. `read` defaults to true, `write` to false, `objects` to `["*"]` (every object). A read-only key gets 403 on a write; a key scoped to some objects gets 403 on any other object.

Objects a key can name when it is minted (server list; the Settings screen offers every one, `tenders` included):

`quotations`, `accounts`, `cases`, `inventory`, `invoices`, `purchase-orders`, `pricing`, `products`, `projects`, `opportunities`, `employees`, `rfqs`, `estimates`, `abm_programs`, `abm_targets`, `standard_quotes`, `sales_orders`, `tenders`.

**Explicit-scope-only objects.** The wildcard `"*"` does NOT reach these; a key must name them: `employees`, `contacts`, `rfqs`, `estimates`, `abm_targets`, `tenders`, `contract_projects`. (`contacts` and `contract_projects` cannot be named when minting a key at all, so they are not reachable over the API today. (verify))

| Endpoint family | Scope name | Write needed for |
|---|---|---|
| `/quotations` | `quotations` | POST, PATCH, DELETE |
| `/accounts` | `accounts` | |
| `/cases` | `cases` | |
| `/inventory` | `inventory` | |
| `/invoices` | `invoices` | |
| `/purchase-orders` | `purchase-orders` | |
| `/products` | `products` | |
| `/opportunities` | `opportunities` | |
| `/projects`, `/project-hours` | `projects` | POST `/projects/:id/invoices` |
| `/employees` | `employees` (explicit) | |
| `/rfqs` | `rfqs` (explicit) | |
| `/estimates` | `estimates` (explicit) | |
| `/standard-quotes` | `standard_quotes` | |
| `/sales-orders` | `sales_orders` | |
| `/abm-programs` | `abm_programs` | |
| `/abm-targets`, `/abm-programs/:id/targets` | `abm_targets` (explicit) | |
| `POST /price` | `pricing` | (read scope suffices) |
| `POST /ask` | the scope of the object you query | (read scope suffices) |
| `/changes` | per object type, see section 22 | |
| `/`, `/openapi.json`, `/metadata`, `/metadata/:entity` | any key with read | |

`project-hours` rows include the person (`employee.*`) only when the key also names `employees`; otherwise the employee columns are removed.

### 1.4 Feature gating (404, not 403)

Each object belongs to a module. A workspace that did not buy the module gets `404 {"error":"Not found"}` on that object's endpoints, so the endpoint's existence is not revealed. Gating map (`src/lib/objectFeatures.ts`): quotations to Quotations; accounts to Accounts; cases to Cases; inventory and purchase-orders to Purchasing; invoices to Invoices; products to Products; opportunities to Pipeline; projects and project-hours to Workforce projects; employees to Business roles; rfqs to RFQ; estimates to Estimator; standard-quotes to Standard Quotes; sales-orders to Sales Orders; abm-* to ABM; price to Pricing engine; tenders to GCC tender; contract_projects to Contract projects. `POST /projects/:id/invoices` also needs Invoices. The change feed (section 22) does not check the module (verify).

### 1.5 Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"Malformed JSON","message":"The request body could not be parsed as JSON."}` (some routes: `{"error":"Invalid JSON body"}` or a plain message) | Body is not JSON, or a required query/body value is malformed. |
| 401 | `{"error":"Unauthorized","message":"Include header: Authorization: Bearer <tenant API key>. ..."}` | No, unknown, revoked or expired key. Also on the meta endpoints for a write-only key. |
| 403 | `{"error":"Forbidden","message":"This API key is not scoped for read access to \"accounts\"."}` (`write access` on a write) | Scope does not allow the object or the direction. |
| 404 | `{"error":"Not found"}` (quotations: `"Quotation not found"`; accounts also echo `"id"`) | Unknown id in your workspace, a referenced id that is not yours, or a module you do not own. |
| 409 | `{"error":"..."}` | Business conflict (superseded quotation; invoice period already billed). |
| 422 | `{"error":"Validation failed","message":"2 fields rejected. See \"details\". Full field reference: GET /api/v1/metadata/quotations","details":[{"field":"...","message":"..."}]}` | Invalid body or invalid list query. The `message` text always names the quotations metadata URL, whichever endpoint answered. |
| 500 | `{"error":"<database message>"}` | Server or database error. |
| 502 / 503 | `{"error":"AI service unavailable"}` / `{"error":"Not configured"}` | `/ask` only. |

### 1.6 Lists: envelope, pagination, filtering, enriched queries

Every list endpoint returns:

```json
{
  "data": [ { "...": "rows" } ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:15:30.412Z" },
  "_links": { "self": "/api/v1/accounts", "next": null, "prev": null }
}
```

`meta.aggregates` and `meta.groups` appear only when requested. `_links.metadata` appears on quotations. `next` and `prev` are relative URLs that repeat your query string.

Query parameters accepted by every list endpoint (all optional, all combinable; unknown field names are a 422 listing the accepted fields):

| Parameter | Meaning |
|---|---|
| `select` | Comma list of fields to return; dotted for nested (`account.name`). Only the endpoint's queryable fields can be selected. |
| `filter` | `field:op:value` clauses joined by `;` (AND). Ops: `eq ne gt gte lt lte like in isnull`. `like` = case-insensitive contains. `in` = comma list. `isnull` = `true` or `false`. Number fields are compared numerically, dates as ISO text. URL-encode the value (`;` is `%3B`). |
| `search` | Case-insensitive contains across the endpoint's searchable fields (ANDed with `filter`). |
| `sort` | Comma list; leading `-` = descending (`-total,ref`). |
| `page`, `limit` | 1-based page; default `limit` 50, clamped to 200. |
| `aggregate` | `count`, `sum:field`, `avg:field`, `min:field`, `max:field` over the filtered set, returned in `meta.aggregates` (keys `count`, `sum_total`, ...). Numeric fields only. |
| `group_by` | Aggregate per distinct value (`meta.groups`: `[{key,count,...}]`). A date field is bucketed by `group_period` (default `month`). |
| `group_period` | `day week month quarter year`; only with a date `group_by`. |
| `group_limit` | Top N groups (max 100); the rest become one `Other` group. |
| `having` | `key:op:value` on group aggregates (`sum_total:gt:50000`), ops `eq ne gt gte lt lte`; needs `group_by`. |
| `group_sort` | `count`, `key` or an aggregate key; descending unless prefixed `+`. |
| `count` | `only` returns `meta` without rows. |

Each list also accepts a few endpoint-specific shortcut parameters (for example `?status=`), shown per endpoint; they combine with `filter` as AND. List endpoints load the workspace's rows and apply the query in memory.

Rows can carry fields that are not queryable (`_links`, `custom_data`, `counts`); they appear in an unprojected row but cannot be named in `select`, `filter` or `sort`.

Conventions: ids are UUIDs; dates `YYYY-MM-DD`; timestamps ISO 8601 (database timestamps carry microseconds and `+00:00`); money is a plain JSON number in the workspace currency; absent values are `null`.

### 1.7 Rate limits and timeouts

No rate limiting is implemented in the application code, and no 429 or `Retry-After` is ever returned. Any limit would come from the hosting platform (verify). `/ask` and `/price` run with a 30 second maximum duration. Quotations accept at most 200 lines per request. Workspaces with the Integration middleware module record call metadata (method, path, status, key id; never bodies) in its message log.

### 1.8 Self-description

`GET /openapi.json` is the machine-readable spec (section 20.4). The older note `API_V1.md` in the repo describes quotations only and is partly out of date (it says there is no pagination).

---

## 2. ABM programs

Account-based marketing programs. Scope `abm_programs` (wildcard allowed), module ABM. Programs hold no personal data. The companies inside a program are a separate, explicitly scoped object (section 3).

### 2.1 GET /abm-programs

Shortcut parameters: `status` (`draft active paused completed archived`), `kind` (`new_business expansion`).
Queryable fields: `id, ref, name, kind, status, goal, goal_metric, goal_target, default_tier, starts_on, ends_on, targets_count, created_at`. Searchable: `ref, name, goal`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/abm-programs?status=active"
```

```json
{
  "data": [
    {
      "id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
      "ref": "ABM-0002",
      "name": "Gulf contractors 2026",
      "kind": "new_business",
      "goal": "Open 5 deals with top contractors",
      "goal_metric": "deals_opened",
      "goal_target": 5,
      "starts_on": "2026-09-01",
      "ends_on": "2026-12-31",
      "status": "active",
      "default_tier": "one_to_few",
      "owner_user_id": "11111111-2222-4333-8444-555555555555",
      "custom_data": null,
      "created_at": "2026-08-30T10:02:11.482113+00:00",
      "updated_at": "2026-10-20T07:44:09.113002+00:00",
      "targets_count": 12,
      "_links": {
        "self": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
        "targets": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13/targets"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:15:30.412Z" },
  "_links": { "self": "/api/v1/abm-programs", "next": null, "prev": null }
}
```

`goal_metric` is one of `deals_won deals_opened accounts_engaged revenue`. Errors: 401, 403, 404 (module), 422 (bad query).

### 2.2 GET /abm-programs/:id

One program with its funnel counted by company (never by person).

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13"
```

```json
{
  "data": {
    "id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
    "ref": "ABM-0002",
    "name": "Gulf contractors 2026",
    "kind": "new_business",
    "goal": "Open 5 deals with top contractors",
    "goal_metric": "deals_opened",
    "goal_target": 5,
    "starts_on": "2026-09-01",
    "ends_on": "2026-12-31",
    "status": "active",
    "default_tier": "one_to_few",
    "owner_user_id": "11111111-2222-4333-8444-555555555555",
    "custom_data": null,
    "created_at": "2026-08-30T10:02:11.482113+00:00",
    "updated_at": "2026-10-20T07:44:09.113002+00:00",
    "funnel": { "targets": 12, "reached": 9, "engaged": 6, "inTalks": 3, "deals": 2, "won": 1, "lost": 0, "dropped": 1 },
    "by_tier": [
      { "tier": "one_to_one", "targets": 2, "engaged": 2, "deals": 1, "won": 1 },
      { "tier": "one_to_few", "targets": 6, "engaged": 3, "deals": 1, "won": 0 },
      { "tier": "one_to_many", "targets": 4, "engaged": 1, "deals": 0, "won": 0 }
    ],
    "money": { "openValue": 480000, "wonValue": 150000, "openDeals": 1, "wonDeals": 1 },
    "_links": {
      "self": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
      "targets": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13/targets"
    }
  },
  "_links": { "self": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13" }
}
```

Errors: 404 `{"error":"Not found"}`.

---

## 3. ABM targets

A company inside one program. Scope `abm_targets`, **explicit only** (a buying group names people and roles). Module ABM.

### 3.1 GET /abm-targets

Shortcut parameters: `progress` (`planned reached engaged in_talks deal_open won lost dropped`), `tier` (`one_to_one one_to_few one_to_many`), `program_id`.
Queryable fields: `id, program_id, program_ref, program_name, account.id, account.name, tier, progress, progress_source, progress_changed_at, next_step, next_step_due, opportunity_id, people_count, created_at`. Searchable: `program_ref, program_name, account.name, next_step`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/abm-targets?progress=engaged"
```

```json
{
  "data": [
    {
      "id": "701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14",
      "program_id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
      "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "tier": "one_to_one",
      "progress": "engaged",
      "progress_source": "auto",
      "progress_changed_at": "2026-10-12T09:30:00+00:00",
      "owner_user_id": "11111111-2222-4333-8444-555555555555",
      "next_step": "Site visit with procurement",
      "next_step_due": "2026-11-05",
      "opportunity_id": null,
      "custom_data": null,
      "created_at": "2026-09-02T06:10:44.221903+00:00",
      "updated_at": "2026-10-12T09:30:00.118322+00:00",
      "program_ref": "ABM-0002",
      "program_name": "Gulf contractors 2026",
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "people_count": 3,
      "_links": {
        "self": "/api/v1/abm-targets/701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14",
        "program": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
        "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:16:02.004Z" },
  "_links": { "self": "/api/v1/abm-targets", "next": null, "prev": null }
}
```

`progress_source` values are not enumerated in the code read; `auto` is illustrative (verify). Private notes, drop reasons and progress reasons are never returned.

### 3.2 GET /abm-targets/:id

The row above plus `buying_group`: contact id and role only (no names, contact details or notes).

```json
{
  "data": {
    "id": "701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14",
    "tier": "one_to_one",
    "progress": "engaged",
    "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
    "people_count": 1,
    "buying_group": [
      {
        "id": "81d2f6a3-4c79-4e05-98b1-1d3a7c5b9e20",
        "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
        "role": "decision_maker",
        "is_primary": true,
        "_links": { "contact": "/api/v1/contacts/5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02" }
      }
    ],
    "_links": { "self": "/api/v1/abm-targets/701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14" }
  },
  "_links": { "self": "/api/v1/abm-targets/701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14" }
}
```

(Other row fields as in 3.1 are present; shortened here.) `role` is one of `decision_maker influencer user blocker unknown`. The `contact` link points at `/api/v1/contacts/:id`, which is not an endpoint of this API (verify).

### 3.3 GET /abm-programs/:id/targets

The companies of one program. Same rows, query parameters and scope as 3.1 (`abm_targets`); `_links.self` is `/api/v1/abm-programs/:id/targets`. An unknown program id returns an empty list, not 404.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13/targets?sort=-next_step_due"
```

---

## 4. Accounts

Companies you sell to. Scope `accounts`, module Accounts. Read only.

### 4.1 GET /accounts

Shortcut parameter: `type` (`prospect oem direct end_customer`).
Queryable fields: `id, name, type, city, phone, email, created_at, referred_by.name`. Searchable: `name, city, email`. Phone and email are decrypted on read (they are stored encrypted).

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/accounts?type=end_customer&search=example"
```

```json
{
  "data": [
    {
      "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "name": "Example Trading LLC",
      "type": "end_customer",
      "city": "Dubai",
      "phone": "+971 4 555 0147",
      "email": "procurement@example-trading.example",
      "referred_by": null,
      "created_at": "2026-03-04T05:22:10.331042+00:00",
      "counts": { "contacts": 2, "cases": 1, "assets": 3, "contracts": 0, "quotes": 4, "workOrders": 1, "invoices": 2 },
      "_links": { "self": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:17:40.220Z" },
  "_links": { "self": "/api/v1/accounts", "next": null, "prev": null }
}
```

`referred_by` is `{ "id", "name" }` or `null`. Errors: 401, 403, 404, 422.

### 4.2 GET /accounts/:id

The full account record with everything related to it. Fields follow the account record (all columns of the account row); the e-invoicing buyer fields appear only in a workspace with e-invoicing, and an individual's ID number is never returned.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
```

```json
{
  "data": {
    "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
    "tenant_id": "00000000-0000-4000-8000-000000000001",
    "ref": "ACC-0007",
    "name": "Example Trading LLC",
    "type": "end_customer",
    "address_line1": "Plot 14, Industrial Area 3",
    "address_line2": null,
    "city": "Dubai",
    "state": null,
    "postal_code": null,
    "country": "AE",
    "phone": "+971 4 555 0147",
    "phone2": null,
    "email": "procurement@example-trading.example",
    "email2": null,
    "website": "https://example-trading.example",
    "industry": "Trading",
    "employee_count": null,
    "annual_revenue": null,
    "gstin": null,
    "notes": null,
    "referred_by_account_id": null,
    "created_at": "2026-03-04T05:22:10.331042+00:00",
    "custom_data": null,
    "marketing_opt_out": false,
    "owner_user_id": null,
    "referred_by": null,
    "contacts": [
      {
        "id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
        "ref": "CON-0003",
        "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Sara Khan",
        "role": "Procurement manager",
        "department": "Purchasing",
        "phone": "+971 50 555 0182",
        "email": "sara.khan@example-trading.example",
        "custom_data": null
      }
    ],
    "sites": [],
    "assets": [],
    "cases": [],
    "quotes": [
      { "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03", "ref": "QT-2026-0042", "status": "draft", "total": 41050, "created_at": "2026-10-26T06:12:31.118820+00:00" }
    ],
    "contracts": [],
    "work_orders": [
      { "id": "ee3b1c52-7a94-4c06-8d1f-2b5a9e7c0d21", "ref": "WO-0011", "status": "scheduled", "scheduled_for": "2026-11-03", "authorized_by": { "kind": "quote", "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03" } }
    ],
    "invoices": []
  },
  "meta": { "generated_at": "2026-10-28T08:18:12.907Z" },
  "_links": { "self": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "collection": "/api/v1/accounts" }
}
```

Arrays are shown partly empty to keep the sample short; `contacts` rows follow the contact record (phone and email decrypted; other columns such as phone2, website, address fields, notes, birthday also present), `assets`, `cases`, `contracts` and `invoices` rows follow their records (all columns), `sites` is always `[]` today. Note that the contact rows (with decrypted phone and email) are returned under the `accounts` scope. Errors: 404 `{"error":"Not found","id":"..."}`.

---

## 5. Cases

Service cases (repair tickets). Scope `cases`, module Cases. Read only; there is no detail endpoint.

### 5.1 GET /cases

Shortcut parameters: `status` (`intake inspection report_sent report_approved quote_sent quote_approved in_repair qa ready closed buyback scrapped`), `account_id`.
Queryable fields: `id, ref, type, status, equipment_label, complaint, disposition, has_loaner, intake_at, closed_at, account.id, account.name, technician_name`. Searchable: `ref, equipment_label, complaint, account.name`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/cases?status=in_repair&account_id=3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
```

```json
{
  "data": [
    {
      "id": "c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
      "ref": "CASE-0031",
      "type": "adhoc",
      "status": "in_repair",
      "equipment_label": "22 kW 3-ph induction motor, serial EX-2291",
      "complaint": "Overheating under load",
      "disposition": "repair",
      "has_loaner": false,
      "intake_at": "2026-10-20T07:05:00+00:00",
      "closed_at": null,
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "technician_name": "R. Menon",
      "_links": {
        "self": "/api/v1/cases/c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
        "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:19:01.511Z" },
  "_links": { "self": "/api/v1/cases", "next": null, "prev": null }
}
```

`type` is `amc adhoc direct`; `disposition` is `repair buyback scrap` or `null`. The row's `_links.self` points at `/api/v1/cases/:id`, which is not an endpoint (verify).

---

## 6. Employees

Staff records. Personal data. Scope `employees`, **explicit only**; the workspace also needs the Business roles module (otherwise `404` with `"message":"The employees module isn't enabled for this workspace."`).

### 6.1 GET /employees

Shortcut parameters: `status` (`active inactive`), `department`.
Queryable fields: `id, employee_code, first_name, last_name, email, phone, department, designation, status, employment_type, wfm_role, valid_from, valid_to, created_at`. Searchable: `employee_code, first_name, last_name, email, department, designation`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/employees?status=active&department=Workshop"
```

```json
{
  "data": [
    {
      "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16",
      "employee_code": "EMP-0042",
      "first_name": "Ravi",
      "last_name": "Menon",
      "email": "ravi.menon@example-trading.example",
      "phone": "+971 50 555 0120",
      "department": "Workshop",
      "designation": "Technician",
      "status": "active",
      "employment_type": "full_time",
      "wfm_role": "employee",
      "valid_from": "2025-01-01",
      "valid_to": null,
      "created_at": "2025-01-02T06:00:00.000000+00:00",
      "custom_data": null,
      "_links": { "self": "/api/v1/employees/923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:20:11.003Z" },
  "_links": { "self": "/api/v1/employees", "next": null, "prev": null }
}
```

### 6.2 GET /employees/:id

Returns the complete employee row, not the shorter list shape: every column of the employee record plus `_links`. Besides the list fields this includes internal columns such as `tenant_id`, `updated_at`, `shift_id`, `site_id`, `technician_id`, `self_service_override`, `remote_mode`, `enrolled_photo_path` and `consent_recorded_at` (fields follow the employee record; verify the exact set against your database).

```json
{
  "data": {
    "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16",
    "tenant_id": "00000000-0000-4000-8000-000000000001",
    "employee_code": "EMP-0042",
    "first_name": "Ravi",
    "last_name": "Menon",
    "email": "ravi.menon@example-trading.example",
    "phone": "+971 50 555 0120",
    "department": "Workshop",
    "designation": "Technician",
    "valid_from": "2025-01-01",
    "valid_to": null,
    "status": "active",
    "employment_type": "full_time",
    "shift_id": null,
    "site_id": null,
    "wfm_role": "employee",
    "technician_id": null,
    "custom_data": null,
    "created_at": "2025-01-02T06:00:00.000000+00:00",
    "updated_at": "2026-09-01T06:00:00.000000+00:00",
    "_links": { "self": "/api/v1/employees/923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16" }
  },
  "_links": { "self": "/api/v1/employees/923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16" }
}
```

---

## 7. Estimates

Project estimates built from a template. Scope `estimates`, **explicit only**; module Estimator. Customer-safe fields only: costs, margin, parameters, the model and the bill of materials are never returned.

### 7.1 GET /estimates

Shortcut parameters: `status` (`draft quoted won lost`), `account_id`.
Queryable fields: `id, ref, name, status, currency, quoted_total, quoted_total_incl_vat, account.id, account.ref, account.name, contact.id, contact.ref, contact.name, template.name, created_at, updated_at`. Searchable: `ref, name, account.name, contact.name, template.name`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/estimates?status=quoted"
```

```json
{
  "data": [
    {
      "id": "812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15",
      "ref": "EST-0009",
      "name": "Warehouse mezzanine, 400 m2",
      "status": "quoted",
      "currency": "AED",
      "quoted_total": 182500,
      "quoted_total_incl_vat": 191625,
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "ref": "ACC-0007", "name": "Example Trading LLC" },
      "contact": { "id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02", "ref": "CON-0003", "name": "Sara Khan" },
      "template": { "name": "Steel structure" },
      "custom_data": null,
      "created_at": "2026-10-10T06:00:00.000000+00:00",
      "updated_at": "2026-10-14T11:20:00.000000+00:00",
      "_links": { "self": "/api/v1/estimates/812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:21:30.700Z" },
  "_links": { "self": "/api/v1/estimates", "next": null, "prev": null }
}
```

`quoted_total` and `quoted_total_incl_vat` are `null` until the estimate has a price. `account`, `contact` and `template` are `null` when unset.

### 7.2 GET /estimates/:id

The same object as one list row, wrapped as `{ "data": {...}, "_links": { "self": "/api/v1/estimates/:id" } }`. A non-UUID id is `404`.

---
## 8. Inventory

Stocked spare parts and materials. Scope `inventory`, module Purchasing. Read only.

### 8.1 GET /inventory

Shortcut parameters: `status` (`active inactive`), `low_stock=true` (only items at or below their reorder level).
Queryable fields: `id, sku, name, description, category, uom, qty_on_hand, reorder_level, unit_cost, supplier_id, status`. Searchable: `sku, name, description, category`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/inventory?low_stock=true&sort=qty_on_hand"
```

```json
{
  "data": [
    {
      "id": "7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307",
      "sku": "BRG-6310-2RS",
      "name": "Deep groove ball bearing 6310-2RS",
      "description": "50 x 110 x 27 mm, sealed",
      "category": "Bearings",
      "uom": "Nos",
      "qty_on_hand": 4,
      "reorder_level": 6,
      "unit_cost": 38.5,
      "supplier_id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508",
      "status": "active",
      "custom_data": null,
      "_links": { "self": "/api/v1/inventory/7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:22:44.100Z" },
  "_links": { "self": "/api/v1/inventory", "next": null, "prev": null }
}
```

### 8.2 GET /inventory/:id

The complete inventory row (all columns) plus `_links`. The endpoint index and the MCP description say "with transaction history", but the route does not return transactions (verify).

```json
{
  "data": {
    "id": "7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307",
    "ref": "INV-0018",
    "tenant_id": "00000000-0000-4000-8000-000000000001",
    "sku": "BRG-6310-2RS",
    "name": "Deep groove ball bearing 6310-2RS",
    "description": "50 x 110 x 27 mm, sealed",
    "category": "Bearings",
    "uom": "Nos",
    "supplier_id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508",
    "qty_on_hand": 4,
    "reorder_level": 6,
    "unit_cost": 38.5,
    "status": "active",
    "notes": null,
    "custom_data": null,
    "created_at": "2026-02-11T09:00:00.000000+00:00",
    "_links": { "self": "/api/v1/inventory/7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307" }
  },
  "_links": { "self": "/api/v1/inventory/7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307" }
}
```

Errors: 404 `{"error":"Not found"}`.

---

## 9. Invoices

Customer invoices. Scope `invoices`, module Invoices. Read only (draft invoices can be raised from project hours, section 14.5).

### 9.1 GET /invoices

Shortcut parameters: `status` (`draft sent partial paid overdue cancelled`), `account_id`.
Queryable fields: `id, ref, status, account.id, account.name, quote_id, work_order_id, due_date, total, paid_amount, issued_at, einvoice_doc_type, einvoice_ready`. Searchable: `ref, account.name`. The two e-invoice fields exist only in a workspace with Saudi e-invoicing switched on.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/invoices?status=overdue&aggregate=count,sum:total"
```

```json
{
  "data": [
    {
      "id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
      "ref": "INV-2026-0113",
      "status": "overdue",
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "quote_id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "work_order_id": null,
      "due_date": "2026-10-15",
      "total": 41050,
      "paid_amount": 10000,
      "issued_at": "2026-09-15T08:00:00+00:00",
      "_links": { "self": "/api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "aggregates": { "count": 1, "sum_total": 41050 }, "generated_at": "2026-10-28T08:23:30.900Z" },
  "_links": { "self": "/api/v1/invoices", "next": null, "prev": null }
}
```

### 9.2 GET /invoices/:id

```json
{
  "data": {
    "id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
    "ref": "INV-2026-0113",
    "status": "overdue",
    "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
    "quote_id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
    "work_order_id": null,
    "case_id": null,
    "contract_id": null,
    "due_date": "2026-10-15",
    "notes": null,
    "terms": "Net 30",
    "total": 41050,
    "paid_amount": 10000,
    "balance_due": 31050,
    "custom_data": null,
    "issued_at": "2026-09-15T08:00:00+00:00",
    "lines": [
      { "id": "a1c3e5b7-2d49-4f60-8b1a-3c5e7a9b1d22", "description": "Supply of 3-phase induction motor 22 kW", "uom": "Nos", "qty": 2, "rate": 18500, "amount": 37000 },
      { "id": "b2d4f6c8-3e5a-4071-9c2b-4d6f8b0c2e33", "description": "Installation and commissioning", "uom": "Lot", "qty": 1, "rate": 4500, "amount": 4050 }
    ],
    "payments": [
      { "amount": 10000, "paid_on": "2026-10-01", "method": "bank_transfer" }
    ],
    "_links": { "self": "/api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709" }
  },
  "_links": { "self": "/api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709" }
}
```

In an e-invoicing workspace the object also carries `einvoice_doc_type`, `einvoice_ready`, `einvoice_uuid`, `einvoice_seq`, `original_invoice_id`, `credit_reason`, `supply_date`, and each line carries `vat_category`, `vat_rate`, `vat_exemption_reason`. The allowed `method` values are not enumerated in the code read (verify). Errors: 404.

---

## 10. Opportunities (deals)

Sales pipeline. Scope `opportunities`, module Pipeline.

### 10.1 GET /opportunities

Shortcut parameters: `stage`, `outcome` (`open won lost dropped`), `account_id`, `owner_id`. Default stages are `qualify propose negotiate won lost`; the list is configurable per workspace.
Queryable fields: `id, ref, title, account_id, account_name, stage, outcome, amount, probability, expected_close, owner_id, source, competitor, created_at, closed_at`. Searchable: `ref, title, account_name, competitor`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/opportunities?outcome=open&sort=-amount"
```

```json
{
  "data": [
    {
      "id": "d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
      "ref": "OPP-0021",
      "title": "22 kW motor replacement programme",
      "description": null,
      "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
      "stage": "propose",
      "outcome": "open",
      "loss_reason": null,
      "amount": 41050,
      "currency": "AED",
      "probability": 50,
      "expected_close": "2026-12-01",
      "owner_id": "11111111-2222-4333-8444-555555555555",
      "source": "referral",
      "competitor": null,
      "custom_data": null,
      "created_at": "2026-10-05T07:00:00.000000+00:00",
      "updated_at": "2026-10-26T06:13:00.000000+00:00",
      "closed_at": null,
      "account_name": "Example Trading LLC",
      "_links": {
        "self": "/api/v1/opportunities/d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
        "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:24:20.000Z" },
  "_links": { "self": "/api/v1/opportunities", "next": null, "prev": null }
}
```

Internal columns (team, probability override reason) are never returned.

### 10.2 GET /opportunities/:id

The row above plus `loss_note`, `lines` and `quotes` (the standard quotes and quotations created from the deal, newest first).

```json
{
  "data": {
    "id": "d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
    "ref": "OPP-0021",
    "title": "22 kW motor replacement programme",
    "stage": "propose",
    "outcome": "open",
    "loss_reason": null,
    "loss_note": null,
    "amount": 41050,
    "currency": "AED",
    "probability": 50,
    "account_name": "Example Trading LLC",
    "lines": [
      {
        "id": "c3e5a7d9-4f5b-4182-8d3c-5e7a9c1d3f44",
        "sl_no": "1",
        "description": "22 kW IE3 motor",
        "uom": "Nos",
        "qty": 2,
        "rate": 18500,
        "discount_pct": 0,
        "amount": 37000,
        "product_id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a",
        "group_id": null,
        "group_label": null,
        "break_of": null,
        "break_qty": null,
        "is_selected": true
      }
    ],
    "quotes": [
      { "object": "quotation", "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03", "ref": "QT-2026-0042", "status": "draft", "subtotal": 41050, "total": 41050, "created_at": "2026-10-26T06:12:31.118820+00:00" }
    ],
    "_links": {
      "self": "/api/v1/opportunities/d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
      "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
    }
  },
  "_links": { "self": "/api/v1/opportunities/d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b" }
}
```

(The remaining list fields are present as in 10.1; shortened here.) `quotes[].object` is `quotation` or `standard_quote`.

---

## 11. Pricing

Prices a document against the workspace's published pricing configuration. Scope `pricing` (a read scope is enough although the method is POST), module Pricing engine.

### 11.1 POST /price

Body:

| Field | Type | Notes |
|---|---|---|
| `document.attributes` | object | Header matching attributes (document_type, customer.*, region, ...). Optional. |
| `document.lines` | array, required | 1 to 200 lines. |
| `document.lines[].line_no` | integer | Default `(index+1)*10`. |
| `document.lines[].attributes` | object | Product/line matching attributes. |
| `document.lines[].quantity`, `.weight_kg` | number | Must be numbers. |
| `document.lines[].cost_items` | array | `[{ "path": string, "qty": number }]`. |
| `document.lines[].manual` | object | `{ CODE: { value, reason? } }`, gated by each component's override policy. |
| `options.trace` | `full` (default), `summary`, `none` | How much of the waterfall to return. |
| `options.pricing_date` | `YYYY-MM-DD` | Default today. |
| `options.config_version` | integer | Replay against a specific version; default the published one. |
| `options.pricing_area`, `options.procedure`, `options.currency` | string | `procedure` is required when the version has more than one. |
| `options.replay_of` | UUID | Re-price a stored pricing document instead of `document.lines`. |

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" "$BASE/price" -d '{
  "document": {
    "attributes": { "document_type": "quotation", "customer": { "group": "contractor" }, "region": "AE" },
    "lines": [
      { "line_no": 10, "quantity": 2, "attributes": { "product": { "category": "Motors" } } }
    ]
  },
  "options": { "trace": "summary", "pricing_date": "2026-10-28" }
}'
```

```json
{
  "data": {
    "pricing_date": "2026-10-28",
    "currency": "AED",
    "totals": { "net": 36000, "subtotals": { "NET": 36000 } },
    "lines": [
      {
        "line_no": 10,
        "net": 36000,
        "subtotals": { "NET": 36000 },
        "components": { "LIST": 37000, "DISC": -1000 },
        "trace": [
          { "step": 10, "component": "LIST", "status": "APPLIED", "calc_type": "PER_UNIT", "value": 18500, "qty": 2, "result": 37000 },
          { "step": 20, "component": "DISC", "status": "APPLIED", "calc_type": "PERCENT", "value": -2.7, "basis": 37000, "result": -1000 },
          { "step": 30, "subtotal": "NET", "status": "SUBTOTAL", "result": 36000 }
        ]
      }
    ]
  },
  "meta": {
    "config_version": 7,
    "procedure": "STANDARD",
    "calc_ms": 12,
    "trace": "summary",
    "generated_at": "2026-10-28T08:26:00.000Z",
    "document_id": "9b8a7c6d-5e4f-4031-b2a1-0f9e8d7c6b5a"
  },
  "_links": { "self": "/api/v1/price" }
}
```

Component codes, subtotal names, the procedure code and the amounts come from the workspace's own configuration; the values above are illustrative. Trace step fields follow the engine (`step, component, subtotal, status, reason, rule_id, matched_on, specificity, calc_type, basis, value, qty, formula, values_used, result, ...`). The response does not include the engine's per-line `flags`. With `trace: "full"` every step including `EXCLUDED` and `SKIPPED` is returned; `summary` returns `APPLIED` and `SUBTOTAL` steps; `none` omits `trace`. Every call is stored and its id returned in `meta.document_id`; send `"options": { "replay_of": "<document_id>" }` to re-price it (`meta.replay_of` is echoed).

Errors:

| Status | Body |
|---|---|
| 422 | `{"error":"Invalid document","message":"document.lines must be a non-empty array."}`; likewise `Invalid options` |
| 422 | `{"error":"AMBIGUOUS_RULE","message":"..."}`, `MISSING_REQUIRED_COMPONENT`, `FORMULA_ERROR` and the other engine codes in `error` |
| 409 | `{"error":"Pricing configuration","message":"..."}`, for example no PUBLISHED configuration (the status comes from the configuration error; 409 per the OpenAPI note, verify) |
| 500 | `{"error":"Pricing failed","message":"Unexpected error while pricing the document."}` |

---

## 12. Products

The sellable catalogue. Scope `products`, module Products. Read only. Cost price and supplier are internal and never returned.

### 12.1 GET /products

Shortcut parameters: `status` (`active inactive`), `category`, `sub_category`, `item_type` (a stable key such as `finished_product`, `raw_material`, `bom_kit`).
Queryable fields: `id, ref, sku, name, description, category, sub_category, item_type, uom, list_price, qty_breaks, tax_percent, status`. Searchable: `ref, sku, name, description, category, sub_category`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/products?category=Motors"
```

```json
{
  "data": [
    {
      "id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a",
      "ref": "PRD-0014",
      "sku": "MOT-22-IE3",
      "name": "22 kW IE3 induction motor",
      "description": "415 V, 4 pole, B3 foot mount",
      "category": "Motors",
      "sub_category": "Induction",
      "item_type": "finished_product",
      "uom": "Nos",
      "list_price": 18500,
      "qty_breaks": [ { "from": 5, "rate": 17800 }, { "from": 10, "rate": null } ],
      "tax_percent": 5,
      "status": "active",
      "custom_data": null,
      "_links": { "self": "/api/v1/products/a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:27:10.000Z" },
  "_links": { "self": "/api/v1/products", "next": null, "prev": null }
}
```

`qty_breaks` is `[{ from, rate }]`; a `null` rate means priced normally at that quantity.

### 12.2 GET /products/:id

The list row plus `created_at` and `updated_at`.

---

## 13. Project hours

One row per worked session over the last 12 months (project costing). Scope `projects`, module Workforce projects. Read only.

### 13.1 GET /project-hours

Shortcut parameters: `project_id`, `account_id`.
Queryable fields: `date, project.id, project.ref, project.name, project.level, project.status, top_project.id, top_project.name, account.id, account.name, employee.id, employee.name, employment_type, minutes, hours, break_minutes, bill_rate, billable_amount, invoiced, assigned`. Searchable: `project.ref, project.name, top_project.name, account.name, employee.name`. The `employee.*` fields exist only for a key that also names `employees`. Unassigned sessions have `project.name = "Unassigned"`.

```bash
curl -s -G -H "Authorization: Bearer $KEY" "$BASE/project-hours" \
  --data-urlencode "filter=date:gte:2026-10-01;date:lte:2026-10-31" \
  --data-urlencode "group_by=project.name" \
  --data-urlencode "aggregate=sum:hours,sum:billable_amount" \
  --data-urlencode "count=only"
```

```json
{
  "data": [],
  "meta": {
    "count": 0, "total": 118, "page": 1, "limit": 50, "has_more": false,
    "aggregates": { "sum_hours": 912.5, "sum_billable_amount": 54750 },
    "groups": [
      { "key": "Plant retrofit", "count": 84, "sum_hours": 655, "sum_billable_amount": 39300 },
      { "key": "Unassigned", "count": 34, "sum_hours": 257.5, "sum_billable_amount": 15450 }
    ],
    "generated_at": "2026-10-28T08:28:00.000Z"
  },
  "_links": { "self": "/api/v1/project-hours", "next": null, "prev": null }
}
```

One row (without `count=only`):

```json
{
  "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16:2026-10-14T04:00:00.000Z",
  "date": "2026-10-14",
  "project": { "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c", "ref": "PRJ-0003", "name": "Plant retrofit", "level": 0, "status": "active" },
  "top_project": { "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c", "name": "Plant retrofit" },
  "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
  "employee": { "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16", "name": "Ravi Menon", "code": "EMP-0042" },
  "employment_type": "full_time",
  "minutes": 450,
  "hours": 7.5,
  "break_minutes": 30,
  "bill_rate": 60,
  "billable_amount": 450,
  "invoiced": false,
  "assigned": true
}
```

Rows have no `_links`. The `id` format is internal; treat it as opaque. Cost is never a column.

---

## 14. Projects

Workforce projects and sub-projects. Scope `projects` (write for the invoice POST), module Workforce projects.

### 14.1 GET /projects

Shortcut parameters: `status` (`planned active on_hold completed cancelled`), `level` (`0` project, `1` to `3` sub-project), `parent_id`, `account_id`.
Queryable fields: `id, ref, name, code, level, parent_id, account_id, status, start_date, end_date, budget_hours, bill_rate`. Searchable: `ref, name, code`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/projects?level=0&status=active"
```

```json
{
  "data": [
    {
      "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
      "ref": "PRJ-0003",
      "name": "Plant retrofit",
      "code": "PO-77812",
      "parent_id": null,
      "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "status": "active",
      "start_date": "2026-09-01",
      "end_date": "2026-12-31",
      "budget_hours": 1200,
      "bill_rate": 60,
      "custom_data": null,
      "created_at": "2026-08-25T06:00:00.000000+00:00",
      "updated_at": "2026-10-01T06:00:00.000000+00:00",
      "level": 0,
      "_links": {
        "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
        "hours": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/hours?from=YYYY-MM-DD&to=YYYY-MM-DD"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:29:00.000Z" },
  "_links": { "self": "/api/v1/projects", "next": null, "prev": null }
}
```

### 14.2 GET /projects/:id

```json
{
  "data": {
    "id": "f2d8b6c3-7a41-4e95-8b0d-4c9a1e7f2b0d",
    "ref": "PRJ-0003.1",
    "name": "Electrical works",
    "code": null,
    "parent_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
    "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
    "status": "active",
    "start_date": "2026-09-01",
    "end_date": null,
    "budget_hours": 400,
    "bill_rate": null,
    "custom_data": null,
    "created_at": "2026-08-25T06:05:00.000000+00:00",
    "updated_at": "2026-08-25T06:05:00.000000+00:00",
    "level": 1,
    "parent": { "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c", "ref": "PRJ-0003", "name": "Plant retrofit", "_links": { "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c" } },
    "sub_projects": [],
    "links": { "site_ids": [], "employee_ids": ["923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16"], "shift_ids": [] },
    "_links": {
      "self": "/api/v1/projects/f2d8b6c3-7a41-4e95-8b0d-4c9a1e7f2b0d",
      "hours": "/api/v1/projects/f2d8b6c3-7a41-4e95-8b0d-4c9a1e7f2b0d/hours?from=YYYY-MM-DD&to=YYYY-MM-DD",
      "invoices": "/api/v1/projects/f2d8b6c3-7a41-4e95-8b0d-4c9a1e7f2b0d/invoices",
      "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
    }
  },
  "_links": { "self": "/api/v1/projects/f2d8b6c3-7a41-4e95-8b0d-4c9a1e7f2b0d" }
}
```

`sub_projects` rows are `{ id, ref, name, _links }`.

### 14.3 GET /projects/:id/hours

Worked hours for the project and everything beneath it, for a period. Totals only; no per-person detail. Query: `from`, `to` (both `YYYY-MM-DD`, required, `to >= from`, at most 366 days).

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/hours?from=2026-10-01&to=2026-10-31"
```

```json
{
  "data": {
    "project_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
    "from": "2026-10-01",
    "to": "2026-10-31",
    "deduct_breaks": true,
    "total_minutes": 39300,
    "total_hours": 655,
    "breakdown": [
      {
        "project_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
        "name": "Plant retrofit",
        "ref": "PRJ-0003",
        "status": "active",
        "parent_id": null,
        "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "depth": 0,
        "own_minutes": 12000,
        "total_minutes": 39300,
        "employees": 5,
        "employees_total": 11,
        "sessions": 40,
        "_links": { "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c" }
      }
    ]
  },
  "_links": {
    "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/hours?from=2026-10-01&to=2026-10-31",
    "project": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c"
  }
}
```

`pending_migration: true` appears in `data` while the project-costing migration is not applied. Errors: 400 `{"error":"from and to (YYYY-MM-DD) are required"}`, `{"error":"to must be on or after from"}`, `{"error":"Pick a window of 366 days or fewer"}`; 404.

### 14.4 GET /projects/:id/invoices

Every invoice raised from this project's hours (its own, its sub-projects', or a parent's that covered it), newest first.

```json
{
  "data": [
    {
      "id": "d4f6a8c0-5b7d-4293-8e4f-6a8c0e2b4d55",
      "project_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
      "project_name": "Plant retrofit",
      "invoice_id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
      "invoice_ref": "INV-2026-0113",
      "invoice_status": "draft",
      "period_from": "2026-09-01",
      "period_to": "2026-09-30",
      "granularity": "project",
      "minutes": 37200,
      "amount": 37200,
      "created_at": "2026-10-01T00:30:00.000000+00:00",
      "_links": {
        "invoice": "/api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
        "project": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c"
      }
    }
  ],
  "_links": { "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices", "project": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c" }
}
```

Needs the Workforce projects and Invoices modules (404 otherwise). While the project-billing migration is pending the response is `{"data":[],"pending_migration":true}`.

### 14.5 POST /projects/:id/invoices

Raise a draft invoice for a period from the project's hours, priced by the rate ladder (project rate, then parent rate, then employment-type rate, then workspace default). Needs a key with **write** on `projects`.

| Body field | Type | Notes |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD`, required | At most 366 days. |
| `granularity` | `project` (default) or `sub_project` | One line for the project, or one per sub-project. |
| `dry_run` | boolean | `true` returns the preview and writes nothing. |
| `top_up` | boolean | Bill only the hours added since the earlier invoice for the same period. |

Dry run:

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  "$BASE/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices" \
  -d '{ "from": "2026-10-01", "to": "2026-10-31", "dry_run": true }'
```

```json
{
  "data": {
    "project": { "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c", "ref": "PRJ-0003", "name": "Plant retrofit", "level": 0, "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "account_name": "Example Trading LLC" },
    "from": "2026-10-01",
    "to": "2026-10-31",
    "granularity": "project",
    "lines": [
      { "group_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c", "group_label": "Plant retrofit", "description": "Plant retrofit", "rate": 60, "source": "project", "employment_type": null, "minutes": 39300, "hours": 655, "amount": 39300 }
    ],
    "minutes": 39300,
    "hours": 655,
    "subtotal": 39300,
    "tax": { "label": "VAT", "rate": 5, "inclusive": false, "amount": 1965 },
    "total": 41265,
    "due_date": "2026-11-27",
    "unassigned_minutes": 0,
    "conflicts": [],
    "top_up": null,
    "billed": [],
    "blockers": []
  },
  "_links": { "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices" }
}
```

`source` is `project`, `parent`, `employment_type` or `default`. `blockers` lists in words why an invoice cannot be raised now (no account, no hours, no rate, period already billed). Cost and margin are removed from the preview. Without `dry_run` the call creates the draft and answers **201**:

```json
{
  "data": { "id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709", "ref": "INV-2026-0114", "total": 41265, "status": "draft" },
  "_links": { "invoice": "/api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709", "project": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c" }
}
```

Errors: 400 (`{"error":"Invalid JSON body"}`, the period validation text, `{"error":"granularity must be project or sub_project"}`), 403 (read-only key), 404, 409 (the first blocker; `Already invoiced on INV-... Bill the difference as a top-up instead.`; `Nothing to top up for that period.`; `Link this project to an account first.`), 503 (`Billing needs migration 0108 ...`), 500.

---
## 15. Purchase orders

Orders placed with your suppliers. Scope `purchase-orders`, module Purchasing. Read only.

### 15.1 GET /purchase-orders

Shortcut parameters: `status` (`draft sent partially_received received cancelled`), `supplier_id`.
Queryable fields: `id, ref, status, supplier.id, supplier.name, quote_id, case_id, order_date, expected_date, total, created_at`. Searchable: `ref, supplier.name`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/purchase-orders?status=sent"
```

```json
{
  "data": [
    {
      "id": "14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e",
      "ref": "PO-2026-0057",
      "status": "sent",
      "supplier": { "id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508", "name": "Example Bearings FZE" },
      "quote_id": null,
      "case_id": "c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
      "order_date": "2026-10-22",
      "expected_date": "2026-11-05",
      "total": 1540,
      "created_at": "2026-10-22T07:30:00.000000+00:00",
      "_links": { "self": "/api/v1/purchase-orders/14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:30:10.000Z" },
  "_links": { "self": "/api/v1/purchase-orders", "next": null, "prev": null }
}
```

### 15.2 GET /purchase-orders/:id

```json
{
  "data": {
    "id": "14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e",
    "ref": "PO-2026-0057",
    "status": "sent",
    "supplier": { "id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508", "name": "Example Bearings FZE", "email": "sales@example-bearings.example", "phone": "+971 6 555 0190" },
    "quote_id": null,
    "case_id": "c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
    "order_date": "2026-10-22",
    "expected_date": "2026-11-05",
    "notes": null,
    "terms": null,
    "total": 1540,
    "custom_data": null,
    "created_at": "2026-10-22T07:30:00.000000+00:00",
    "lines": [
      {
        "id": "e5a7c9b1-6d8f-4304-9f5e-7a9c1e3b5d66",
        "inventory_item_id": "7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307",
        "description": "Deep groove ball bearing 6310-2RS",
        "uom": "Nos",
        "qty_ordered": 40,
        "qty_received": 0,
        "rate": 38.5,
        "amount": 1540
      }
    ],
    "_links": { "self": "/api/v1/purchase-orders/14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e" }
  },
  "_links": { "self": "/api/v1/purchase-orders/14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e" }
}
```

Supplier email and phone are returned as stored (verify whether the supplier columns are encrypted at rest). Errors: 404.

---

## 16. Quotations

The only object with write support. A header plus ordered lines, optionally grouped into additive or mutually exclusive alternative groups. Scope `quotations` (write for POST, PATCH, DELETE), module Quotations. Full field metadata is also served live at `GET /metadata/quotations`.

### 16.1 GET /quotations

Shortcut parameters: `status` (a status your workspace uses, default `draft sent approved rejected`), `account_id`.
Queryable fields: `id, ref, status, total, revision, outcome, loss_reason, created_at, quote_date, valid_until, line_count, account.id, account.name, invoice_count, invoiced_total, paid_total, balance_due`. Searchable: `ref, account.name`. The four invoice fields roll up the quotation's own non-cancelled invoices (quote to cash).

```bash
curl -s -G -H "Authorization: Bearer $KEY" "$BASE/quotations" \
  --data-urlencode "filter=status:eq:draft;total:gte:10000" \
  --data-urlencode "sort=-total" --data-urlencode "aggregate=sum:total"
```

```json
{
  "data": [
    {
      "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "ref": "QT-2026-0042",
      "status": "draft",
      "total": 41050,
      "revision": 1,
      "outcome": "open",
      "loss_reason": null,
      "created_at": "2026-10-26T06:12:31.118820+00:00",
      "quote_date": "2026-10-26",
      "valid_until": "2026-11-25",
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "line_count": 2,
      "invoice_count": 0,
      "invoiced_total": 0,
      "paid_total": 0,
      "balance_due": 0,
      "_links": {
        "self": "/api/v1/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
        "pdf": "/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03/print",
        "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "aggregates": { "sum_total": 41050 }, "generated_at": "2026-10-28T08:31:00.000Z" },
  "_links": { "self": "/api/v1/quotations", "metadata": "/api/v1/metadata/quotations", "next": null, "prev": null }
}
```

### 16.2 GET /quotations/:id

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03"
```

```json
{
  "data": {
    "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
    "ref": "QT-2026-0042",
    "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
    "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
    "entity_id": null,
    "type": "quotation",
    "status": "draft",
    "business_status": null,
    "outcome": "open",
    "name": "Supply of 22 kW motors and installation",
    "ref_no": null,
    "pr_no": null,
    "po_number": null,
    "po_amount": null,
    "quote_date": "2026-10-26",
    "valid_until": "2026-11-25",
    "inquiry_date": null,
    "submitted_at": null,
    "closed_at": null,
    "updated_at": "2026-10-26T06:12:31.118820+00:00",
    "notes": null,
    "terms": "Payment 30 days from invoice.",
    "scope_of_work": null,
    "discount_type": "pct",
    "discount_pct": 0,
    "discount_fixed": 0,
    "gst_rate": 5,
    "asset_ids": [],
    "selected_option_id": null,
    "custom_data": null,
    "meta": null,
    "total": 41050,
    "revision": 1,
    "superseded_by": null,
    "created_at": "2026-10-26T06:12:31.118820+00:00",
    "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
    "contact": { "id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02", "name": "Sara Khan" },
    "lines": [
      {
        "id": "0e4c6a91-3d27-4b85-9f10-a2c8d5e7b104",
        "sl_no": "1",
        "description": "Supply of 3-phase induction motor 22 kW",
        "uom": "Nos",
        "qty": 2,
        "rate": 18500,
        "discount_pct": 0,
        "amount": 37000,
        "group_id": null,
        "group_label": null,
        "group_type": null,
        "group_description": null,
        "category": "material",
        "deduction": 0,
        "inventory_item_id": null
      },
      {
        "id": "9a1f3b52-6c48-4d07-8e39-b1d2c4a6f205",
        "sl_no": "2",
        "description": "Installation and commissioning",
        "uom": "Lot",
        "qty": 1,
        "rate": 4500,
        "discount_pct": 10,
        "amount": 4050,
        "group_id": null,
        "group_label": null,
        "group_type": null,
        "group_description": null,
        "category": "labour",
        "deduction": 0,
        "inventory_item_id": null
      }
    ],
    "line_count": 2,
    "totals": { "subtotal": 41050, "discount": 0, "deductions": 0, "total": 41050 },
    "_links": {
      "self": "/api/v1/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "pdf": "/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03/print"
    }
  },
  "_links": { "self": "/api/v1/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03", "metadata": "/api/v1/metadata/quotations" }
}
```

Lines are sorted in natural order of `sl_no` (1, 2, 10). `total` is pre-tax; `gst_rate` is a display-layer figure and is not added to it.

### 16.3 POST /quotations

Creates a quotation with its lines (**201**). Only `account_id` is required. The reference (`ref`) is generated from the workspace's Quote ID format. Header fields below; `GET /metadata/quotations` is the live, authoritative list.

| Field | Type | Notes |
|---|---|---|
| `account_id` | uuid, required | Must belong to your workspace (else 404). |
| `contact_id` | uuid | Must belong to your workspace. |
| `entity_id` | string (64) | Issuing legal entity; omit for the default. |
| `type` | `quotation` `technical` `budgetary` `supply` `repair` | Default `quotation`. `technical` hides pricing on the document. |
| `status` | string (40) | A status from the workspace's configured pipeline; default `draft`. A closed status needs `outcome` won, lost or dropped. |
| `business_status` | `pending` `po_received` | |
| `outcome` | `open` `won` `lost` `dropped` | Default `open`. |
| `name` | string (300) | Title. |
| `ref_no`, `pr_no`, `po_number` | string (100) | Your own references. |
| `po_amount` | number >= 0 | |
| `quote_date`, `valid_until`, `inquiry_date` | `YYYY-MM-DD` | |
| `submitted_at`, `closed_at` | ISO 8601 | Stored as given on create; never auto-stamped on create. |
| `notes`, `terms` | text | |
| `scope_of_work` | rich text | Sanitised server-side. |
| `discount_type` | `pct` `fixed` | Default `pct`. |
| `discount_pct` | number 0 to 100 | |
| `discount_fixed` | number >= 0 | Capped at the subtotal. |
| `gst_rate` | number 0 to 100 | `null` = no tax row. Not part of `total`. |
| `asset_ids` | uuid[] | Every id must be yours. |
| `selected_option_id` | string (64) | `group_id` of the alternative group that counts. |
| `custom_data` | object | Keyed by custom field key. |
| `meta` | object | Free-form, stored untouched. |
| `lines` | array, max 200 | See below. |

Line fields: `description` (required), `sl_no` (string, 40), `uom` (string, 20), `qty` (>= 0, default 1), `rate` (>= 0, default 0), `discount_pct` (0 to 100), `group_id` (64), `group_label` (200), `group_description`, `group_type` (`additive` default, or `alternative`), `category` (`labour` `material` `testing` `transport`), `deduction` (>= 0, honoured only on `material` lines), `inventory_item_id` (uuid, must be yours; reporting only).

Read-only and rejected with 422 if sent: `id`, `ref`, `total`, `updated_at`, `revision`, `superseded_by`, `created_at`, and on lines `id` and `amount`. Unknown fields are rejected, not ignored. Strings that look like numbers are accepted for number fields.

Money rules: `amount = qty x rate x (1 - discount_pct/100)`; `subtotal` = sum over effective lines (lines of an alternative group other than `selected_option_id` are excluded); `total = subtotal - header discount - material deductions`. A percentage discount is rounded to a whole unit.

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" "$BASE/quotations" -d '{
  "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
  "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
  "name": "Supply of 22 kW motors and installation",
  "quote_date": "2026-10-26",
  "valid_until": "2026-11-25",
  "gst_rate": 5,
  "terms": "Payment 30 days from invoice.",
  "lines": [
    { "sl_no": "1", "description": "Supply of 3-phase induction motor 22 kW", "uom": "Nos", "qty": 2, "rate": 18500, "category": "material" },
    { "sl_no": "2", "description": "Installation and commissioning", "uom": "Lot", "qty": 1, "rate": 4500, "discount_pct": 10, "category": "labour" }
  ]
}'
```

Response 201: `{ "data": { ... } }` with the same quotation object as 16.2 (without `account` and `contact`), `lines`, `line_count`, `totals` and `_links`, and with `status: "draft"`, `outcome: "open"`, `revision: 1`, `total: 41050`. The creation is recorded in Change History with actor `api:v1`.

Errors: 400 malformed JSON; 403 read-only or wrongly scoped key; 404 `{"error":"Account not found in this tenant"}` (also `Contact not found in this tenant`, `One or more assets not found in this tenant`, `One or more inventory items not found in this tenant`); 422 validation; 500.

422 example:

```json
{
  "error": "Validation failed",
  "message": "2 fields rejected. See \"details\". Full field reference: GET /api/v1/metadata/quotations",
  "details": [
    { "field": "total", "message": "Read-only: this value is calculated by the server and cannot be set directly." },
    { "field": "lines[0].qty", "message": "must be >= 0" }
  ]
}
```

Other 422 messages: `Unknown status "x". Allowed values are tenant-configured ...`, `Set an outcome (won, lost, or dropped) when creating a quotation directly in a closed status.`, `A rejected quotation can't be marked won.`

### 16.4 PATCH /quotations/:id

Send only the fields to change (same fields as 16.3, none required). `lines`, when present, **replaces all lines**; send the complete set. Omit `lines` to keep them. The total is always recomputed. Moving off a closed status resets `outcome` to `open` unless you send one. `submitted_at` is auto-stamped the first time the status leaves its initial value, and `closed_at` when `outcome` leaves `open` (an explicit value always wins). A superseded version (one with `superseded_by` set) is read-only.

```bash
curl -s -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  "$BASE/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03" -d '{ "status": "sent", "valid_until": "2026-12-15" }'
```

Response 200: `{ "data": { ... } }` the updated quotation object (as in 16.3's response) with `status: "sent"`, `valid_until: "2026-12-15"` and `submitted_at` stamped.

Errors: 404 `{"error":"Quotation not found"}`; 409 `{"error":"This version has been superseded and is read-only -- edit the latest version instead."}`; 422 (also `Unknown status`, the closed-status and rejected-won rules, `Set an outcome (won, lost, or dropped) before closing this quotation -- or before clearing the outcome on one that's already closed.`); 500. Note: replacing lines is not atomic with the header update (verify behaviour on a mid-request failure).

### 16.5 DELETE /quotations/:id

```bash
curl -s -X DELETE -H "Authorization: Bearer $KEY" "$BASE/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03"
```

```json
{ "data": { "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03", "ref": "QT-2026-0042", "deleted": true } }
```

The deletion is kept in the workspace's deletion log and in Change History. Errors: 404.

---

## 17. RFQs

Requests for quotation sent to suppliers. Scope `rfqs`, **explicit only** (supplier prices are commercially sensitive); module RFQ. Read only.

### 17.1 GET /rfqs

Shortcut parameters: `status` (`draft sent partially_replied replied awarded closed cancelled`), `origin_type` (`standard_quote quote opportunity case inspection_report work_order fence_project pricing manual`), `origin_id`.
Queryable fields: `id, ref, title, status, origin_type, origin_id, origin_label, respond_by, required_by, created_at, updated_at`. Searchable: `ref, title, origin_label`. Supplier prices are on the detail endpoint only.

```json
{
  "data": [
    {
      "id": "28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f",
      "ref": "RFQ-0012",
      "title": "Bearings for case CASE-0031",
      "status": "sent",
      "origin_type": "case",
      "origin_id": "c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
      "origin_label": "CASE-0031",
      "respond_by": "2026-11-01",
      "required_by": "2026-11-10",
      "delivery_terms": "DAP Dubai",
      "currency": "AED",
      "custom_data": null,
      "created_at": "2026-10-21T08:00:00.000000+00:00",
      "updated_at": "2026-10-22T07:00:00.000000+00:00",
      "_links": { "self": "/api/v1/rfqs/28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:32:00.000Z" },
  "_links": { "self": "/api/v1/rfqs", "next": null, "prev": null }
}
```

### 17.2 GET /rfqs/:id

The RFQ record (all columns except internal notes and tenant id) with lines, suppliers and their quoted prices. Never returned: the reply-link nonce, internal notes, message bodies.

```json
{
  "data": {
    "id": "28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f",
    "ref": "RFQ-0012",
    "title": "Bearings for case CASE-0031",
    "status": "sent",
    "origin_type": "case",
    "origin_id": "c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
    "origin_label": "CASE-0031",
    "requested_by": "11111111-2222-4333-8444-555555555555",
    "buyer_id": null,
    "respond_by": "2026-11-01",
    "required_by": "2026-11-10",
    "delivery_terms": "DAP Dubai",
    "currency": "AED",
    "notes_to_supplier": null,
    "custom_data": null,
    "created_at": "2026-10-21T08:00:00.000000+00:00",
    "updated_at": "2026-10-22T07:00:00.000000+00:00",
    "lines": [
      {
        "id": "f6b8d0c2-7e90-4415-8a6f-8b0d2f4c6e77",
        "sl_no": 1,
        "product_id": null,
        "description": "Deep groove ball bearing 6310-2RS",
        "spec": "50 x 110 x 27 mm",
        "uom": "Nos",
        "qty": 40,
        "required_by": "2026-11-10",
        "status": "open",
        "awarded_response_id": null,
        "awarded_unit_cost": null
      }
    ],
    "suppliers": [
      {
        "id": "07c9e1d3-8fa1-4526-9b70-9c1e3a5d7f88",
        "supplier_id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508",
        "supplier_name": "Example Bearings FZE",
        "status": "replied",
        "sent_at": "2026-10-21T09:00:00+00:00",
        "viewed_at": "2026-10-21T10:00:00+00:00",
        "replied_at": "2026-10-22T06:30:00+00:00",
        "supplier_quote_ref": "EB-Q-2210",
        "currency": "AED",
        "incoterm": "DAP",
        "freight_amount": 120,
        "payment_terms": "30 days",
        "valid_until": "2026-11-30"
      }
    ],
    "responses": [
      {
        "id": "18d0f2e4-90b2-4637-8c81-0d2f4b6e8a99",
        "rfq_supplier_id": "07c9e1d3-8fa1-4526-9b70-9c1e3a5d7f88",
        "rfq_line_id": "f6b8d0c2-7e90-4415-8a6f-8b0d2f4c6e77",
        "status": "quoted",
        "unit_price": 38.5,
        "currency": "AED",
        "fx_rate": 1,
        "lead_time_days": 7,
        "moq": 10,
        "offered_description": null,
        "valid_until": "2026-11-30",
        "source": "portal",
        "is_awarded": false,
        "submitted_at": "2026-10-22T06:30:00+00:00"
      }
    ],
    "_links": { "self": "/api/v1/rfqs/28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f" }
  },
  "_links": { "self": "/api/v1/rfqs/28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f" }
}
```

The line `status`, supplier `status`, response `status` and `source` values shown (`open`, `replied`, `quoted`, `portal`) are illustrative; the code read does not list them (verify). Errors: 404.

---

## 18. Sales orders

Scope `sales_orders` (the wildcard reaches it), module Sales Orders. Read only. Never returned: creator and owner ids, cancellation note, contact details of a party, the order type's template, attachments, any cost or margin.

### 18.1 GET /sales-orders

Shortcut parameters: `status` (`draft confirmed cancelled` for orders made in BPMSquare; an ERP-fed order carries the ERP's word in `status_label`), `account_id`, `source_id` (the quote or deal it was made from).
Queryable fields: `id, ref, status, status_label, spine, origin, type.id, type.name, pricing_mode, currency, customer_po, source_type, source_id, opportunity_id, subtotal, discount_total, tax_total, shipping_amount, total, line_count, credit_check, price_check, stock_check, invoice_count, invoiced_total, paid_total, requested_date, expected_date, confirmed_at, sent_at, account.id, account.name, contact_id, created_at, updated_at`. Searchable: `ref, customer_po, account.name`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/sales-orders?status=confirmed"
```

```json
{
  "data": [
    {
      "id": "3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10",
      "ref": "SO-0004",
      "type": { "id": "4d8f2b96-0e35-4c71-b4a8-7f9c3e1d5a11", "name": "Standard order" },
      "origin": "bpmsquare",
      "status": "confirmed",
      "status_label": null,
      "spine": "open",
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
      "bill_to": { "name": "Example Trading LLC", "address": "Plot 14, Industrial Area 3, Dubai" },
      "ship_to": { "name": "Example Trading LLC, Jebel Ali store", "address": "Warehouse 6, Jebel Ali" },
      "customer_po": "PO-77812",
      "source_type": "standard_quote",
      "source_id": "5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
      "opportunity_id": null,
      "currency": "AED",
      "pricing_mode": "internal",
      "subtotal": 41050,
      "discount_total": 0,
      "tax_total": 2052.5,
      "shipping_amount": 0,
      "total": 43102.5,
      "requested_date": "2026-11-20",
      "expected_date": "2026-11-24",
      "confirmed_at": "2026-10-27T05:00:00+00:00",
      "sent_at": null,
      "line_count": 2,
      "credit_check": "passed",
      "price_check": null,
      "stock_check": "warning",
      "invoice_count": 0,
      "invoiced_total": 0,
      "paid_total": 0,
      "custom_data": null,
      "created_at": "2026-10-27T04:40:00.000000+00:00",
      "updated_at": "2026-10-27T05:00:00.000000+00:00",
      "_links": {
        "self": "/api/v1/sales-orders/3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10",
        "pdf": "/sales-orders/3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10/print",
        "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:33:00.000Z" },
  "_links": { "self": "/api/v1/sales-orders", "next": null, "prev": null }
}
```

`spine`: `open in_progress completed cancelled`. `origin`: `bpmsquare` or `erp`. `pricing_mode`: `internal` or `external`. `source_type`: `standard_quote quotation opportunity lead email order direct erp`. `credit_check`, `price_check`, `stock_check`: `passed warning failed not_run` or `null`.

### 18.2 GET /sales-orders/:id

The list object plus `notes`, `terms`, `lines`, `erp_documents`, `erp_checks`, `erp_transfers`.

```json
{
  "data": {
    "id": "3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10",
    "ref": "SO-0004",
    "status": "confirmed",
    "total": 43102.5,
    "line_count": 2,
    "notes": "Deliver to the Jebel Ali store.",
    "terms": "Payment 30 days from invoice.",
    "lines": [
      {
        "id": "29e1a3f5-a1c3-4748-9d92-1e3a5c7f9b00",
        "line_no": 1,
        "product_id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a",
        "description": "22 kW IE3 induction motor",
        "printed_text": "415 V, 4 pole",
        "qty": 2,
        "uom": "Nos",
        "unit_price": 18500,
        "discount_pct": 0,
        "tax_pct": 5,
        "line_total": 37000,
        "requested_date": "2026-11-20",
        "confirmed_qty": 2,
        "confirmed_date": "2026-11-24",
        "availability_source": "master",
        "availability_at": "2026-10-27T05:01:00+00:00"
      }
    ],
    "erp_documents": [
      { "kind": "invoice", "number": "90001234", "date": "2026-11-25", "due_date": "2026-12-25", "amount": 43102.5, "currency": "AED", "status": "Open", "status_spine": "open", "erp_id": "0090001234", "fetched_at": "2026-11-26T01:00:00+00:00" }
    ],
    "erp_checks": [
      { "kind": "credit", "status": "passed", "message": "Within credit limit.", "checked_at": "2026-10-27T05:00:30+00:00", "stale": false }
    ],
    "erp_transfers": [
      { "attempted_at": "2026-10-27T05:02:00+00:00", "result": "accepted", "erp_number": "0000451122", "step": null, "message": null }
    ],
    "_links": { "self": "/api/v1/sales-orders/3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10" }
  },
  "_links": { "self": "/api/v1/sales-orders/3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10" }
}
```

(All header fields of 18.1 are also present; shortened here.) `availability_source` is `erp` or `master`. `erp_documents[].kind` is for example `invoice` or a delivery; `status_spine` is for example `open`, `paid`, `cancelled` (verify the full set). `erp_transfers[].result` values are not listed in the code read (verify). Errors: 404.

---

## 19. Standard quotes

Scope `standard_quotes` (the wildcard reaches it), module Standard Quotes (separate from Quotations). Read only. Never returned: line margin checks, the supplier-request link, template, authorship, print options, contact details.

### 19.1 GET /standard-quotes

Shortcut parameters: `status` (`draft sent accepted rejected expired`), `account_id`, `opportunity_id`.
Queryable fields: `id, ref, status, inquiry_date, valid_until, sent_at, closed_at, subtotal, header_discount_pct, tax_pct, shipping_amount, total, line_count, account.id, account.name, contact_id, opportunity_id, created_at, updated_at`. Searchable: `ref, account.name`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/standard-quotes?status=sent&sort=-total"
```

```json
{
  "data": [
    {
      "id": "5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
      "ref": "SQ-0031",
      "status": "sent",
      "inquiry_date": "2026-10-20",
      "valid_until": "2026-11-20",
      "sent_at": "2026-10-24T08:00:00+00:00",
      "closed_at": null,
      "subtotal": 41050,
      "header_discount_pct": 0,
      "tax_pct": 5,
      "shipping_amount": 0,
      "total": 43102.5,
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
      "opportunity_id": "d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
      "line_count": 2,
      "custom_data": null,
      "created_at": "2026-10-20T07:00:00.000000+00:00",
      "updated_at": "2026-10-24T08:00:00.000000+00:00",
      "_links": {
        "self": "/api/v1/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
        "pdf": "/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12/print",
        "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-10-28T08:34:00.000Z" },
  "_links": { "self": "/api/v1/standard-quotes", "next": null, "prev": null }
}
```

### 19.2 GET /standard-quotes/:id

The list object plus `intro_text`, `notes`, `terms` and `lines`.

```json
{
  "data": {
    "id": "5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
    "ref": "SQ-0031",
    "status": "sent",
    "total": 43102.5,
    "line_count": 2,
    "intro_text": "Thank you for your enquiry.",
    "notes": null,
    "terms": "Valid for 30 days.",
    "lines": [
      {
        "id": "3af2b4c6-b2d4-4859-8ea3-2f4b6d8a0c11",
        "sl_no": "1",
        "description": "22 kW IE3 induction motor",
        "uom": "Nos",
        "qty": 2,
        "rate": 18500,
        "discount_pct": 0,
        "amount": 37000,
        "product_id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a",
        "group_id": null,
        "group_label": null,
        "group_type": null,
        "break_of": null,
        "break_qty": null,
        "is_selected": true,
        "show_on_pdf": true
      }
    ],
    "_links": {
      "self": "/api/v1/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
      "pdf": "/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12/print",
      "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
    }
  },
  "_links": { "self": "/api/v1/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12" }
}
```

(The remaining header fields of 19.1 are present; shortened here.) Errors: 404. The MCP description of the list tool mentions ERP invoice roll-ups (`invoice_count` and so on); the standard quote list does not carry them (verify).

---
## 19A. Tenders

GCC tender deals and their Bill of quantities. Read-only. Scope `tenders`, explicit only: a key with access to everything gets 403, so the key must name `tenders`. Module GCC tender and Pipeline; a workspace without them gets 404. A tender's id is its deal id, so `/tenders/:id` and `/opportunities/:id` take the same uuid.

Never returned on any tender endpoint: cost per unit, markup, who or what gave the price (supplier, RFQ, past deal), decision reasons, the source e-mail, custom fields.

### 19A.1 GET /tenders

Shortcut parameters: `stage` (`received bid_no_bid estimating submitted clarifications awarded bid_lost no_bid`), `outcome` (`open won lost dropped`), `decision` (`go no_go`), `portal` (`ariba email excel other`), `closing` (a whole number of days from 1 to 365: only open tenders whose bid end date is today or within that many days; anything else is 422).
Queryable fields: `id, ref, title, account_name, stage, outcome, amount, expected_close, tender_no, issuer_name, portal, closing_at, bid_bond_amount, bid_bond_currency, bid_bond_expiry, addenda_count, decision, decided_at, created_at`. Searchable: `ref, title, account_name, tender_no, issuer_name`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/tenders?outcome=open&closing=14"
```

```json
{
  "data": [
    {
      "id": "e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
      "ref": "OPP-0004",
      "title": "Drainage package, phase 2",
      "account_name": "Example Authority",
      "stage": "estimating",
      "outcome": "open",
      "amount": 1250000,
      "tender_no": "T-2026-118",
      "issuer_name": "Example Authority",
      "portal": "email",
      "closing_at": "2026-11-12",
      "decision": "go",
      "_links": {
        "self": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
        "boq": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/boq"
      }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false, "generated_at": "2026-11-01T08:00:00.000Z" },
  "_links": { "self": "/api/v1/tenders", "next": null, "prev": null }
}
```

(Shortened: the other queryable fields are present on each row.)

### 19A.2 GET /tenders/:id

The row above plus `boq`: a summary of the current Bill of quantities, or `null` when none is uploaded. `_links` carries `self`, `deal` (`/api/v1/opportunities/:id`), `boq` and `wbs`.

```json
{
  "data": {
    "id": "e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
    "ref": "OPP-0004",
    "tender_no": "T-2026-118",
    "stage": "estimating",
    "boq": { "lines": 12, "priced": 6, "unpriced": 6, "stale": 0, "amount": 480000, "file_name": "BOQ-drainage.xlsx", "version": 2 },
    "_links": {
      "self": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
      "deal": "/api/v1/opportunities/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
      "boq": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/boq",
      "wbs": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/wbs"
    }
  },
  "_links": { "self": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14" }
}
```

(Shortened; the other row fields are present as in 19A.1.) An id that is not a tender of the workspace is 404.

### 19A.3 GET /tenders/:id/boq

One row per line of the tender's Bill of quantities, paged, filtered and searched like any list (section 1.6). No Bill of quantities yet is `data: []` with `meta.source: null`, status 200. Otherwise `meta.source` holds `file_name`, `version` and `uploaded_at`.
Queryable fields: `id, tender_id, tender_ref, tender_no, row_no, item_no, cost_code, description, details, client_columns, unit, quantity, rate, amount, rate_source, price_as_of, status, wbs_code, wbs_parts`. Searchable: `tender_ref, tender_no, item_no, cost_code, description, details, wbs_code`. `client_columns` and `wbs_parts` are returned but not queried.

| Field | Meaning |
|---|---|
| `item_no` | The client's item number (the file's Item # column). |
| `description` | The line's name (the file's Narration). |
| `details` | The long text (the file's Description). |
| `client_columns` | The client's other columns as they wrote them (for example Sr #, Bill #, Section, Page #, Revision #, Boq #), or `null`. |
| `rate`, `amount` | Our unit rate and the line amount; `null` while the line is unpriced. |
| `rate_source` | Where the rate came from: `boq_rate`, `bom`, `past_project`, `supplier`, `manual`, `estimate`. |
| `status` | `priced`, `unpriced`, `stale` or `removed`. |
| `wbs_code` | Where the line sits in the tender's WBS (section 19A.4): the item code for a whole line, the list `code:percent` joined by `;` for a split line (`2.1:60;2.2:15;2.3:25`), `null` while the line is in no item. |
| `wbs_parts` | The shares of a split line, each with `wbs_code`, `share_pct`, `quantity` and `amount` (the client amount of that share); an empty list for a whole line. |

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/tenders/$ID/boq?filter=status:eq:unpriced"
```

```json
{
  "data": [
    {
      "id": "0b7e5d31-4a96-4c28-8f1e-92a3c6d4b705",
      "tender_id": "e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
      "tender_ref": "OPP-0004",
      "tender_no": "T-2026-118",
      "row_no": 14,
      "item_no": "2.2",
      "cost_code": null,
      "description": "HDPE pipe 300 mm",
      "details": "Supply, lay and test HDPE pipe, 300 mm, including bedding and backfill.",
      "client_columns": { "Sr #": "14", "Bill #": "2", "Section": "Drainage", "Page #": "3" },
      "unit": "m",
      "quantity": 450,
      "rate": null,
      "amount": null,
      "rate_source": null,
      "price_as_of": null,
      "status": "unpriced",
      "wbs_code": "2.1:60;2.2:40",
      "wbs_parts": [
        { "wbs_code": "2.1", "share_pct": 60, "quantity": 270, "amount": null },
        { "wbs_code": "2.2", "share_pct": 40, "quantity": 180, "amount": null }
      ]
    }
  ],
  "meta": { "count": 1, "total": 6, "page": 1, "limit": 50, "has_more": false, "source": { "file_name": "BOQ-drainage.xlsx", "version": 2, "uploaded_at": "2026-10-30T09:12:00+00:00" } },
  "_links": { "self": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/boq" }
}
```

(Shortened.)

### 19A.4 GET /tenders/:id/wbs

The tender's WBS (work breakdown structure), one row per item in tree order, paged, filtered, searched and sorted like any list (section 1.6). Scope `tenders` (explicit only). The module needs Pipeline; a workspace without it, and an id that is not a tender of the workspace, gets 404. A tender with no WBS gives `data: []`, and so does a workspace whose database update for the WBS is not applied yet (`meta.wbs_pending: true`).
Queryable fields: `id, tender_id, code, name, parent_id, parent_code, level, owner_name, note, line_count, shared_count, priced_count, client_amount, parts`. Searchable: `code, name`. `parts` is returned but not queried.

| Field | Meaning |
|---|---|
| `code`, `name` | The item's code (1, 1.1, or your ERP's) and name. |
| `parent_id`, `parent_code` | The item it sits under; `null` at the top level. |
| `level` | 1 to 3. |
| `owner_name` | The owner's **name** only (no email or id), or `null`. |
| `line_count`, `shared_count`, `priced_count` | BOQ lines in the item and its sub-items, how many of those are shares of split lines, and how many are priced. A split line counts once for each share. |
| `client_amount` | The client amount rolled up from the item's lines and sub-items; a split line counts by its share. |
| `parts` | The item's own parts: one entry per BOQ line held in it, with `boq_line_id`, `item_no`, `share_pct`, `quantity`, `amount` (client amount of that share) and the line's `status`. |

`meta` carries `wbs_pending` and, for the whole WBS, `wbs_total` (`line_count`, `shared_count`, `client_amount`) and `unassigned` (`lines`, `client_amount`: lines in no item and the unassigned rest of split lines). Cost, markup and margin are never returned. `meta.total` stays the number of items, as on every other list.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/tenders/$ID/wbs?filter=level:eq:1"
```

```json
{
  "data": [
    {
      "id": "5d1f7c20-3b84-4a19-9e62-7c0a1d8f4b36",
      "tender_id": "e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14",
      "code": "2",
      "name": "Pipework",
      "parent_id": null,
      "parent_code": null,
      "level": 1,
      "owner_name": "Example Estimator",
      "note": null,
      "line_count": 2,
      "shared_count": 1,
      "priced_count": 1,
      "client_amount": 31920,
      "parts": [
        { "boq_line_id": "0b7e5d31-4a96-4c28-8f1e-92a3c6d4b705", "item_no": "2.2", "share_pct": 40, "quantity": 180, "amount": null, "status": "unpriced" }
      ]
    }
  ],
  "meta": {
    "count": 1, "page": 1, "limit": 50, "has_more": false,
    "wbs_pending": false,
    "total": { "line_count": 4, "shared_count": 1, "client_amount": 220750 },
    "unassigned": { "lines": 9, "client_amount": 695630 },
    "generated_at": "2026-11-04T10:00:00.000Z"
  },
  "_links": { "self": "/api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/wbs", "next": null, "prev": null }
}
```

(Shortened.) The OpenAPI document lists the path as `/tenders/{id}/wbs`.

### 19A.5 Bulk load without the API: Data Workbench

The same lines can be loaded in bulk through Data Workbench, object **Tender BOQ lines**. Import adds lines and updates existing ones by item number; it never removes a line. Export carries the Record ID of each line. Update matches on that Record ID only. Only the Upload BOQ button on the tender screen removes lines that a revised file no longer holds. The **WBS code** column (the same text as `wbs_code` above) is on Export and Update only: Update puts a line in an item, splits it (`2.1:60;2.2:15;2.3:25`, which must add up to 100) or makes it unassigned (empty cell), and Import never reads it.

The WBS itself is the Data Workbench object **Tender WBS items**. Import adds items to an existing tender (the **Tender** column is a Deal ID or tender number; a code already on the tender is skipped; the parent is named by code and may come later in the file; the owner is an active employee's email). Export carries each item's Record ID, owner email, `Lines`, `Shared lines` and `Client amount`. Update matches on the Record ID and changes name, code, parent, owner and note. Neither carries a cost.

---

## 20. API index, metadata and OpenAPI

These meta endpoints answer for any key with read access (a write-only key gets 401). They are not feature gated.

### 20.1 GET /

The self-describing index: name, version `1.0`, a text description of authentication, `start_here`, the full `endpoints` map, `conventions`, `query`, `access_control`, `webhooks`, `ask` and `coming_soon`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE"
```

```json
{
  "name": "BPMSquare REST API",
  "version": "1.0",
  "generated_at": "2026-10-28T08:35:00.000Z",
  "authentication": "Bearer token ...",
  "start_here": {
    "openapi": "GET /api/v1/openapi.json ...",
    "metadata": "GET /api/v1/metadata ...",
    "quotation_fields": "GET /api/v1/metadata/quotations ...",
    "changes": "GET /api/v1/changes?since=<cursor> ..."
  },
  "endpoints": { "GET /api/v1/accounts": "List all accounts", "...": "..." },
  "conventions": { "errors": "...", "totals": "...", "children": "...", "unknown_fields": "..." }
}
```

(Abbreviated; the real response also carries `query`, `access_control`, `webhooks`, `ask` and `coming_soon`.) The index lists most endpoints but not all of them; this document is the complete list.

### 20.2 GET /metadata

Lists the entities with field-level metadata. Only `quotations` is described today.

```json
{
  "description": "Machine-readable description of every entity the v1 API exposes for writing: ...",
  "entities": [
    {
      "key": "quotations",
      "entity": "quotation",
      "description": "A customer quotation: a header carrying commercial terms plus an ordered set of line items, ...",
      "endpoint": "/api/v1/quotations",
      "field_count": 35,
      "children": ["quote_line"],
      "_links": { "metadata": "/api/v1/metadata/quotations", "collection": "/api/v1/quotations" }
    }
  ],
  "documented_count": 1,
  "not_yet_documented": { "message": "These endpoints are read-only and have no field-level metadata yet. ...", "endpoints": ["/api/v1/accounts", "/api/v1/cases", "..."] },
  "_links": { "self": "/api/v1/metadata", "api_index": "/api/v1" }
}
```

`field_count` is the number of quotation fields at the time of writing (verify the exact number against your instance).

### 20.3 GET /metadata/:entity

`GET /metadata/quotations` returns every field with `field`, `type`, `label`, `description`, `required_on_create`, `writable`, plus when applicable `computed`, `read_only`, `allowed_values`, `min`, `max`, `max_length`, `default`, `relation`, `example`; the same for the `lines` child (with `max_items: 200`); and `relations`. Any other entity: `404 {"error":"Unknown entity","message":"No metadata for \"x\".","available":["quotations"]}`.

```json
{
  "data": {
    "entity": "quotation",
    "plural": "quotations",
    "table": "quotes",
    "endpoint": "/api/v1/quotations",
    "fields": [
      { "field": "account_id", "type": "uuid", "label": "Account", "description": "The customer this quotation is for. ...", "required_on_create": true, "writable": true, "relation": { "entity": "account", "endpoint": "/api/v1/accounts" } },
      { "field": "total", "type": "number", "label": "Total", "description": "subtotal - header discount - material deductions ...", "required_on_create": false, "writable": false, "computed": true }
    ],
    "children": [ { "key": "lines", "max_items": 200, "entity": "quote_line", "fields": [ { "field": "description", "type": "text", "required_on_create": true, "writable": true } ] } ],
    "relations": [ { "field": "account_id", "entity": "account", "endpoint": "/api/v1/accounts" } ]
  },
  "usage": { "create": "POST /api/v1/quotations ...", "read_one": "GET /api/v1/quotations/:id", "update": "PATCH /api/v1/quotations/:id ...", "delete": "DELETE /api/v1/quotations/:id", "notes": ["..."] },
  "_links": { "self": "/api/v1/metadata/quotations", "all_metadata": "/api/v1/metadata", "collection": "/api/v1/quotations" }
}
```

(Abbreviated.)

### 20.4 GET /openapi.json

An OpenAPI 3.0.3 document (`servers: [{ "url": "/api/v1" }]`, bearer security) generated from the same registry. Import it into Postman, Insomnia, SAP CPI or a code generator. The quotation entity has a full schema with POST, PATCH and DELETE. Every other list endpoint gets a generic list and detail path with the shared query parameters. Also included: `/changes`, `/price` and `/ask`.

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/openapi.json" -o bpmsquare-openapi.json
```

Coverage notes for code generators (from reading the generator, verify against the live document):

- Paths documented in the spec that this API does not serve: `GET /cases/{id}` (there is no case detail endpoint).
- Endpoints served but missing from the spec: `/project-hours`, `/projects/{id}/hours`, `/projects/{id}/invoices` (GET and POST), `/abm-programs/{id}/targets`, `/metadata`, `/metadata/{entity}`, `/openapi.json` itself and the index.
- The shared query parameter list in the spec omits `group_period`, `group_limit`, `having` and `group_sort`, which the engine accepts.
- Detail responses for the non-quotation objects are described only as "OK" with no schema.

---

## 21. Natural-language query: POST /ask

Ask a question in plain English about one object. The question is compiled by an AI model into the same validated query as section 1.6 (never into SQL), executed with your read scope over your workspace's rows, and the exact query string is echoed back so you can reuse it. The model never sees your data. A field that is not on the object's list is a 422.

Scope: read access to the object you name (`project_hours` uses `projects`; the `employee.*` columns of project hours additionally need `employees`). Module gating applies as for the object's own endpoint (404). Needs `ANTHROPIC_API_KEY` configured on the server (503 otherwise).

Body:

| Field | Type | Notes |
|---|---|---|
| `object` | string, required | One of the queryable objects below. |
| `question` | string, required | Plain English. |

Queryable objects (25): `quotations`, `accounts`, `cases`, `inventory`, `products`, `opportunities`, `tenders`, `tender_boq_lines`, `contract_projects`, `rfqs`, `standard_quotes`, `sales_orders`, `abm_programs`, `abm_targets`, `estimates`, `projects`, `project_hours`, `employees`, `invoices`, `purchase-orders`, `contacts`, `assets`, `suppliers`, `work-orders`, `leads`. The fields you can ask about are the object's queryable fields (listed in each section above). Objects without an endpoint of their own here have these fields: contacts `id, ref, name, role, department, city, state, account.id, account.name`; assets `id, ref, name, kind, make, model, rating, serial, is_loaner, loaner_status, account.*`; suppliers `id, ref, name, type, city, status, phone, email, created_at`; work-orders `id, ref, status, auth_kind, scheduled_for, account.*, asset_name, technician_name, case_ref`; leads `id, title, source, status, created_at, account.*`; tenders `id, ref, title, account_name, stage, outcome, amount, expected_close, tender_no, issuer_name, portal, closing_at, bid_bond_amount, bid_bond_currency, bid_bond_expiry, addenda_count, decision, decided_at, created_at`; tender_boq_lines (the BOQ lines of every tender, the fields of section 19A.3) `id, tender_id, tender_ref, tender_no, row_no, item_no, cost_code, description, details, client_columns, unit, quantity, rate, amount, rate_source, price_as_of, status`; contract_projects `id, ref, name, status, account_name, contract_value, currency, budget_total, budget_state, margin_pct, planned_end, updated_at`. `tenders` and `tender_boq_lines` both need a key that names `tenders`. `contacts` and `contract_projects` are explicit-scope objects that a key cannot currently be minted with, so those two are effectively unreachable (verify).

### 21.1 Example: a ranked list

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" "$BASE/ask" \
  -d '{ "object": "quotations", "question": "top 3 draft quotes over 10,000 by value" }'
```

```json
{
  "question": "top 3 draft quotes over 10,000 by value",
  "object": "quotations",
  "answerable": true,
  "compiled": "/api/v1/quotations?filter=status%3Aeq%3Adraft%3Btotal%3Agt%3A10000&sort=-total&limit=3",
  "data": [
    {
      "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "ref": "QT-2026-0042",
      "status": "draft",
      "total": 41050,
      "revision": 1,
      "outcome": "open",
      "loss_reason": null,
      "created_at": "2026-10-26T06:12:31.118820+00:00",
      "quote_date": "2026-10-26",
      "valid_until": "2026-11-25",
      "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" },
      "line_count": 2,
      "invoice_count": 0,
      "invoiced_total": 0,
      "paid_total": 0,
      "balance_due": 0,
      "_links": { "self": "/api/v1/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03", "pdf": "/quotations/b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03/print", "account": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01" }
    }
  ],
  "meta": { "count": 1, "total": 1, "page": 1, "limit": 3, "has_more": false, "generated_at": "2026-10-28T08:36:00.000Z" }
}
```

### 21.2 Example: an aggregate

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" "$BASE/ask" \
  -d '{ "object": "quotations", "question": "total value of won quotes by customer, biggest first" }'
```

```json
{
  "question": "total value of won quotes by customer, biggest first",
  "object": "quotations",
  "answerable": true,
  "compiled": "/api/v1/quotations?filter=outcome%3Aeq%3Awon&aggregate=sum%3Atotal&group_by=account.name&group_sort=sum_total",
  "data": [ { "id": "…", "ref": "QT-2026-0031", "outcome": "won", "total": 96000, "account": { "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01", "name": "Example Trading LLC" } } ],
  "meta": {
    "count": 1, "total": 1, "page": 1, "limit": 50, "has_more": false,
    "aggregates": { "sum_total": 96000 },
    "groups": [ { "key": "Example Trading LLC", "count": 1, "sum_total": 96000 } ],
    "generated_at": "2026-10-28T08:37:00.000Z"
  }
}
```

`data` holds the matching rows (first page); the answer to an aggregate question is in `meta.aggregates` and `meta.groups`. The echoed `compiled` string always uses the object name as the path (`/api/v1/<object>`), which is not a live path for every object (for example `sales_orders` is served at `/sales-orders`, and `tender_boq_lines` is served per tender at `/tenders/:id/boq`); lift the query string, not the path.

### 21.3 When the question cannot be answered

```json
{
  "question": "which customers are most likely to churn",
  "object": "quotations",
  "answerable": false,
  "message": "That can't be answered from the available quotations fields. Queryable fields: id, ref, status, total, ..."
}
```

Errors: 422 `{"error":"Unknown object","message":"object must be one of: ..."}`, 422 `{"error":"Missing question",...}`, 422 `Could not interpret the question` or a validation error if the model produced a query the engine rejects, 403, 404, 502 `{"error":"AI service unavailable","message":"Could not compile the question right now. Try again shortly."}`, 503 `{"error":"Not configured","message":"Natural-language queries need ANTHROPIC_API_KEY set on the server."}`.

---

## 22. Change feed: GET /changes

A workspace-wide, ordered log of every create, update and delete, for sync. Poll with the cursor from the previous response instead of re-listing whole objects. The cursor is a keyset over (time, id), so nothing is skipped or repeated across pages. Needs a key with read access; the feed shows only the object types the key could read through the list endpoints.

Query parameters:

| Parameter | Notes |
|---|---|
| `since` | Cursor from a previous response. Omit for the beginning of the log. A malformed cursor is 422. |
| `object_type` | Only one object type, e.g. `quotes`. 403 if the key cannot read it. |
| `limit` | Default 100, maximum 500. |

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/changes?object_type=quotes&limit=100"
```

```json
{
  "data": [
    {
      "id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "object_type": "quotes",
      "object_id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "object_label": "QT-2026-0042",
      "action": "create",
      "changes": [
        { "field": "account_id", "from": null, "to": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01" },
        { "field": "total", "from": null, "to": 41050 }
      ],
      "actor": "api:v1",
      "at": "2026-10-26T06:12:31.502114+00:00"
    },
    {
      "id": "8b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e",
      "object_type": "quotes",
      "object_id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "object_label": "QT-2026-0042",
      "action": "update",
      "changes": [ { "field": "status", "from": "draft", "to": "sent" } ],
      "actor": "sara.admin@example-trading.example",
      "at": "2026-10-27T09:41:12.318204+00:00"
    }
  ],
  "meta": { "count": 2, "has_more": false, "object_type": "quotes" },
  "cursor": "MjAyNi0xMC0yN1QwOTo0MToxMi4zMTgyMDQrMDA6MDB8OGIyYzNkNGUtNWY2MC00YjdjLTlkOGUtMGYxYTJiM2M0ZDVl",
  "_links": { "self": "/api/v1/changes", "next": "/api/v1/changes?since=MjAyNi0xMC0yN1QwOTo0MToxMi4zMTgyMDQrMDA6MDB8OGIyYzNkNGUtNWY2MC00YjdjLTlkOGUtMGYxYTJiM2M0ZDVl&object_type=quotes&limit=100" }
}
```

Notes:

- `action` is `create`, `update`, `delete` or `reopen`. `changes` is a list of `{ field, from, to }`; encrypted personal fields (account and contact phone, email and similar) appear as `"[redacted]"` with `"redacted": true`; line changes appear as `Line 1`, `Line 2 added`, and so on. The product cost price is stripped from product changes.
- `actor` is the person's email, or `api:v1` for API writes.
- `meta.has_more` is true when the page is full (`count == limit`), so a final full page can report `true` and the next call return nothing.
- When no rows are returned the response `cursor` repeats your `since` (or `null`); keep it.
- Object types are those the app logs, for example `accounts, contacts, quotes, cases, invoices, purchase_orders, inventory, products, employees, rfqs, estimates, opportunities, wfm_projects, standard_quotes, sales_orders, abm_programs, abm_target_accounts`. Types with no v1 object scope (assets, suppliers, work orders, leads) appear only for a wildcard key. Mapping to scopes: quotes to `quotations`, purchase_orders to `purchase-orders`, wfm_projects to `projects`, abm_target_accounts to `abm_targets`, tender and contract-project types to `tenders` and `contract_projects` (explicit only). The feed holds back a tender's cost entries (`BOQ cost <item>` and `BOQ price all`, which carry cost and markup); other BOQ entries such as `BOQ upload` and `BOQ rate <item>` are shown to a key that names `tenders`.
- Errors: 401, 403 (`object_type` outside the key's scope), 422 `{"error":"Invalid cursor","message":"`since` must be a cursor returned by a previous /changes response."}`, 500.

---

## 23. Webhooks (push)

Instead of polling `/changes`, a workspace admin can register an HTTPS endpoint that receives the same events as signed batches.

**Registering.** Settings, Webhooks (when the Webhooks library is on) or Settings, Webhooks & push (otherwise); workspace admin only. Give a name and an `https://` URL (private, loopback and internal addresses are refused, at registration and again at delivery) and choose objects: `accounts, contacts, assets, suppliers, quotes, cases, work_orders, invoices, purchase_orders, inventory`, or all (`*`). A secret `whsec_` followed by 48 hex characters is generated and shown to the admin; use it to verify signatures. A new webhook only sends events after it was registered. "Test" sends a signed `ping`. Webhooks are not scoped by API key: they are created by an admin and (with `*`) can carry any logged object type.

**Delivery.** `POST` with a JSON body, 10 second timeout:

```
Content-Type: application/json
X-BPMSquare-Signature: <hex HMAC-SHA256 of the raw body, key = your whsec_ secret>
X-BPMSquare-Delivery: <delivery_id>
```

```json
{
  "delivery_id": "0f1e2d3c-4b5a-4968-8777-665544332211",
  "sent_at": "2026-10-28T20:30:04.118Z",
  "events": [
    {
      "id": "8b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e",
      "object_type": "quotes",
      "object_id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "object_label": "QT-2026-0042",
      "action": "update",
      "changes": [ { "field": "status", "from": "draft", "to": "sent" } ],
      "actor": "sara.admin@example-trading.example",
      "at": "2026-10-27T09:41:12.318204+00:00"
    }
  ]
}
```

The event shape is identical to a `/changes` item. The test ping has `object_type: "ping"`, `action: "ping"`, `changes: null`.

**Semantics.**

- Up to 100 events per delivery, oldest first. Any 2xx response is success and advances the webhook's cursor; any other status, a timeout or a connection error is a failure: the same events are re-sent in a later delivery (with a new `delivery_id`), so make your handler idempotent on `events[].id`.
- 15 consecutive failures pause the webhook automatically; an admin resumes it.
- Timing: the dispatcher is a scheduled job (`/api/webhooks/cron`, secret-protected). In this repository's `vercel.json` it is scheduled once a day (20:30 UTC), and the code notes that near-real-time delivery needs an external scheduler calling it every few minutes. Confirm the schedule for your workspace (verify).
- The separate "Push to ERP" button sends one record on demand to the ERP endpoint set in Settings, as `{ "event": "...", "data": { ... }, "sent_at": "..." }`, signed the same way with that endpoint's secret.

**Verifying the signature (Node, Express).** Sign over the raw bytes, so do not parse the JSON before checking.

```js
import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.BPMSQUARE_WEBHOOK_SECRET; // the whsec_... value from Settings

app.post("/hooks/bpmsquare", express.raw({ type: "application/json" }), (req, res) => {
  const given = req.get("X-BPMSquare-Signature") || "";
  const expected = crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");
  const ok =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).send("bad signature");

  const { delivery_id, events } = JSON.parse(req.body.toString("utf8"));
  for (const e of events) {
    // De-duplicate on e.id, then handle e.object_type / e.action / e.changes
  }
  res.sendStatus(200); // any 2xx acknowledges the batch
});

app.listen(3000);
```

---

## 24. Known gaps worth knowing before you build

- `GET /cases/:id`, `/contacts/:id` and similar links appear in some `_links` but are not endpoints.
- `GET /accounts/:id` returns decrypted contact phone and email under the `accounts` scope, and `GET /employees/:id` returns the full employee row (including internal ids) rather than the list shape.
- No rate limit is enforced by the application.
- Quotations are the only writable object; no other object has create, update or delete in v1.

---
## 25. MCP server

### 25.1 What it is and how mcp.json is used

The `mcp-server/mcp.json` file (name `bpmsquare`, manifest version `1.21.0`) is a **tool manifest**: for each tool it gives a name, a description, an HTTP method, a path under `/api/v1` and a JSON-Schema `inputSchema`. Every tool is a thin wrapper over one REST endpoint described in this document; the result of a tool call is the JSON body of that endpoint. The manifest has no tools that do anything the REST API cannot.

The repository contains only the manifest; the process that exposes it to an MCP client (Claude Desktop, an AI assistant or any MCP host) is not in this repository (verify). A bridge is expected to do the following with a manifest entry:

- Set the base URL to `api_base` with your workspace domain: `https://<your-workspace-domain>/api/v1`.
- Send `Authorization: Bearer <key>` on every call (see 25.2).
- For `GET` tools, substitute `{id}` in the path from the argument `id` and send every other argument as a query-string parameter. For `POST` tools, substitute `{id}` and send the other arguments as the JSON body. (This mapping is how the manifest reads; verify it against the bridge you use.)
- Return the response body as the tool result; a non-2xx status is returned as the error body shown in section 1.5.

A typical MCP client entry, assuming a generic stdio or HTTP bridge named `bpmsquare-mcp` (the command name is a placeholder, verify the actual launcher you are given):

```json
{
  "mcpServers": {
    "bpmsquare": {
      "command": "bpmsquare-mcp",
      "args": [
        "--manifest",
        "mcp-server/mcp.json"
      ],
      "env": {
        "BPMSQUARE_API_BASE": "https://bpm.example-trading.com/api/v1",
        "BPMSQUARE_API_KEY": "bpm_live_xxxxxxxx"
      }
    }
  }
}
```

### 25.2 Authentication

The same per-workspace bearer key as the REST API (section 1.2). Create a dedicated scoped, **read-only** key for an AI assistant and name only the objects it needs. The manifest text says the key is generated under "Settings, Admin, this tenant"; in the current app it is Settings, API keys & developer. Tools over explicit-scope objects (`list_rfqs`, `get_rfq`, `list_estimates`, `get_estimate`, `list_abm_targets`, `get_abm_target`, `list_employees`, `get_employee`, `list_tenders`, `get_tender`, `get_tender_boq`) only work with a key that names that object. `create_project_invoice` is the only tool that needs a key with **write** on `projects`.

### 25.3 Tools at a glance

| Tool | Calls | Scope | REST section |
|---|---|---|---|
| `list_accounts` | `GET /api/v1/accounts` | accounts, read | 4 |
| `get_account` | `GET /api/v1/accounts/{id}` | accounts, read | 4 |
| `list_cases` | `GET /api/v1/cases` | cases, read | 5 |
| `list_quotations` | `GET /api/v1/quotations` | quotations, read | 16 |
| `list_inventory` | `GET /api/v1/inventory` | inventory, read | 8 |
| `get_inventory_item` | `GET /api/v1/inventory/{id}` | inventory, read | 8 |
| `list_projects` | `GET /api/v1/projects` | projects, read | 14 |
| `get_project` | `GET /api/v1/projects/{id}` | projects, read | 14 |
| `get_project_hours` | `GET /api/v1/projects/{id}/hours` | projects, read | 14 |
| `get_project_invoices` | `GET /api/v1/projects/{id}/invoices` | projects, read | 14 |
| `create_project_invoice` | `POST /api/v1/projects/{id}/invoices` | projects, write | 14 |
| `query_project_hours` | `GET /api/v1/project-hours` | projects, read | 13 |
| `list_products` | `GET /api/v1/products` | products, read | 12 |
| `get_product` | `GET /api/v1/products/{id}` | products, read | 12 |
| `list_opportunities` | `GET /api/v1/opportunities` | opportunities, read | 10 |
| `get_opportunity` | `GET /api/v1/opportunities/{id}` | opportunities, read | 10 |
| `list_rfqs` | `GET /api/v1/rfqs` | rfqs (explicit), read | 17 |
| `list_standard_quotes` | `GET /api/v1/standard-quotes` | standard_quotes, read | 19 |
| `list_sales_orders` | `GET /api/v1/sales-orders` | sales_orders, read | 18 |
| `list_abm_programs` | `GET /api/v1/abm-programs` | abm_programs, read | 2 |
| `get_abm_program` | `GET /api/v1/abm-programs/{id}` | abm_programs, read | 2 |
| `list_abm_targets` | `GET /api/v1/abm-targets` | abm_targets (explicit), read | 3 |
| `get_abm_target` | `GET /api/v1/abm-targets/{id}` | abm_targets (explicit), read | 3 |
| `get_rfq` | `GET /api/v1/rfqs/{id}` | rfqs (explicit), read | 17 |
| `get_standard_quote` | `GET /api/v1/standard-quotes/{id}` | standard_quotes, read | 19 |
| `get_sales_order` | `GET /api/v1/sales-orders/{id}` | sales_orders, read | 18 |
| `list_estimates` | `GET /api/v1/estimates` | estimates (explicit), read | 7 |
| `get_estimate` | `GET /api/v1/estimates/{id}` | estimates (explicit), read | 7 |
| `list_purchase_orders` | `GET /api/v1/purchase-orders` | purchase-orders, read | 15 |
| `get_purchase_order` | `GET /api/v1/purchase-orders/{id}` | purchase-orders, read | 15 |
| `list_invoices` | `GET /api/v1/invoices` | invoices, read | 9 |
| `get_invoice` | `GET /api/v1/invoices/{id}` | invoices, read | 9 |
| `list_employees` | `GET /api/v1/employees` | employees (explicit), read | 6 |
| `get_employee` | `GET /api/v1/employees/{id}` | employees (explicit), read | 6 |
| `list_tenders` | `GET /api/v1/tenders` | tenders (explicit), read | 19A |
| `get_tender` | `GET /api/v1/tenders/{id}` | tenders (explicit), read | 19A |
| `get_tender_boq` | `GET /api/v1/tenders/{id}/boq` | tenders (explicit), read | 19A |
| `get_tender_wbs` | `GET /api/v1/tenders/{id}/wbs` | tenders (explicit), read | 19A.4 |

38 tools. Not available as tools (use REST): creating, changing or deleting quotations, `/price`, `/ask`, `/changes`, quotation detail, case detail, contacts. The manifest lists `create_quotation` among its "coming soon" tools although the REST API already supports it.

### 25.4 Tool reference

Each tool shows its input schema, a sample call (the arguments an assistant sends), the HTTP request that results, and a sample result. Results are the endpoint's response body, shown with one row and a reduced set of fields; the full object is in the REST section named.

#### 25.4.1 list_accounts

List all CRM accounts. Returns OEM vendors, direct customers, and end-customers with their record counts.

Calls `GET /api/v1/accounts`. Scope: accounts, read. REST reference: section 4.

Input schema:

```json
{
  "type": "object",
  "properties": {}
}
```

Sample call:

```json
{
  "name": "list_accounts",
  "arguments": {}
}
```

Request sent:

```text
GET /api/v1/accounts
```

Sample result:

```json
{
  "data": [
    {
      "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "name": "Example Trading LLC",
      "type": "end_customer",
      "city": "Dubai",
      "phone": "+971 4 555 0147",
      "email": "procurement@example-trading.example",
      "referred_by": null,
      "created_at": "2026-03-04T05:22:10.331042+00:00",
      "counts": {
        "contacts": 2,
        "cases": 1,
        "assets": 3,
        "contracts": 0,
        "quotes": 4,
        "workOrders": 1,
        "invoices": 2
      },
      "_links": {
        "self": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
      }
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/accounts",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.2 get_account

Get full account detail including contacts, assets, open cases, quotations, AMC contracts, work orders and invoices.

Calls `GET /api/v1/accounts/{id}`. Scope: accounts, read. REST reference: section 4.

Input schema:

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Account ID, e.g. acc_krishna"
    }
  }
}
```

Sample call:

```json
{
  "name": "get_account",
  "arguments": {
    "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
  }
}
```

Request sent:

```text
GET /api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01
```

Sample result:

```json
{
  "data": {
    "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
    "ref": "ACC-0007",
    "name": "Example Trading LLC",
    "type": "end_customer",
    "city": "Dubai",
    "referred_by": null,
    "contacts": [
      {
        "id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
        "name": "Sara Khan",
        "role": "Procurement manager"
      }
    ],
    "sites": [],
    "assets": [],
    "cases": [],
    "quotes": [
      {
        "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
        "ref": "QT-2026-0042",
        "status": "draft",
        "total": 41050,
        "created_at": "2026-10-26T06:12:31.118820+00:00"
      }
    ],
    "contracts": [],
    "work_orders": [],
    "invoices": []
  },
  "meta": {
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/accounts/3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
    "collection": "/api/v1/accounts"
  }
}
```

Row fields shortened; see section 4.2 for the full object.

#### 25.4.3 list_cases

List service cases. Optionally filter by status or account.

Calls `GET /api/v1/cases`. Scope: cases, read. REST reference: section 5.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Filter by case status",
      "enum": [
        "intake",
        "inspection",
        "report_sent",
        "report_approved",
        "quote_sent",
        "quote_approved",
        "in_repair",
        "qa",
        "ready",
        "closed",
        "buyback",
        "scrapped"
      ]
    },
    "account_id": {
      "type": "string",
      "description": "Filter by account ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_cases",
  "arguments": {
    "status": "in_repair",
    "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
  }
}
```

Request sent:

```text
GET /api/v1/cases?status=in_repair&account_id=3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01
```

Sample result:

```json
{
  "data": [
    {
      "id": "c41d8f06-9e2b-47a3-b5c1-3a7e0d9f6b06",
      "ref": "CASE-0031",
      "type": "adhoc",
      "status": "in_repair",
      "equipment_label": "22 kW 3-ph induction motor, serial EX-2291",
      "complaint": "Overheating under load",
      "disposition": "repair",
      "has_loaner": false,
      "intake_at": "2026-10-20T07:05:00+00:00",
      "closed_at": null,
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Example Trading LLC"
      },
      "technician_name": "R. Menon"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/cases",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.4 list_quotations

List quotations with totals and status. Optionally filter by status or account.

Calls `GET /api/v1/quotations`. Scope: quotations, read. REST reference: section 16.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Filter by quote status",
      "enum": [
        "draft",
        "sent",
        "approved",
        "rejected"
      ]
    },
    "account_id": {
      "type": "string",
      "description": "Filter by account ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_quotations",
  "arguments": {
    "status": "draft",
    "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01"
  }
}
```

Request sent:

```text
GET /api/v1/quotations?status=draft&account_id=3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01
```

Sample result:

```json
{
  "data": [
    {
      "id": "b7d1e0c2-5a3f-4e18-8c92-6f4a1d9e2b03",
      "ref": "QT-2026-0042",
      "status": "draft",
      "total": 41050,
      "revision": 1,
      "outcome": "open",
      "quote_date": "2026-10-26",
      "valid_until": "2026-11-25",
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Example Trading LLC"
      },
      "line_count": 2,
      "invoice_count": 0,
      "invoiced_total": 0,
      "paid_total": 0,
      "balance_due": 0
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/quotations",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.5 list_inventory

List inventory stock items with quantity on hand, reorder level, and preferred supplier. Optionally filter to low-stock items only.

Calls `GET /api/v1/inventory`. Scope: inventory, read. REST reference: section 8.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "low_stock": {
      "type": "boolean",
      "description": "If true, only return items at or below their reorder level"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_inventory",
  "arguments": {
    "low_stock": true
  }
}
```

Request sent:

```text
GET /api/v1/inventory?low_stock=true
```

Sample result:

```json
{
  "data": [
    {
      "id": "7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307",
      "sku": "BRG-6310-2RS",
      "name": "Deep groove ball bearing 6310-2RS",
      "uom": "Nos",
      "qty_on_hand": 4,
      "reorder_level": 6,
      "unit_cost": 38.5,
      "supplier_id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508",
      "status": "active"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/inventory",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.6 get_inventory_item

Get full detail for one inventory item, including custom fields.

Calls `GET /api/v1/inventory/{id}`. Scope: inventory, read. REST reference: section 8.

Input schema:

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Inventory item ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "get_inventory_item",
  "arguments": {
    "id": "7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307"
  }
}
```

Request sent:

```text
GET /api/v1/inventory/7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307
```

Sample result:

```json
{
  "data": {
    "id": "7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307",
    "sku": "BRG-6310-2RS",
    "name": "Deep groove ball bearing 6310-2RS",
    "qty_on_hand": 4,
    "reorder_level": 6,
    "unit_cost": 38.5,
    "status": "active",
    "notes": null,
    "custom_data": null
  },
  "_links": {
    "self": "/api/v1/inventory/7d2b9e40-1c85-4a6f-93d8-e5a0b1c2d307"
  }
}
```

Row fields shortened; see section 8.2.

#### 25.4.7 list_projects

List workforce projects and sub-projects (project costing): ref, name, contract/PO code, level (0 = project, 1-3 = sub-project), parent_id, account_id, status, dates, budget hours. Filter by status, level, parent_id or account_id.

Calls `GET /api/v1/projects`. Scope: projects, read. REST reference: section 14.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "planned, active, on_hold, completed or cancelled"
    },
    "level": {
      "type": "string",
      "description": "0 for top-level projects only, 1-3 for sub-projects at that level"
    },
    "parent_id": {
      "type": "string",
      "description": "Only the sub-projects directly under this project"
    },
    "account_id": {
      "type": "string",
      "description": "Only projects for this customer account"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_projects",
  "arguments": {
    "status": "active",
    "level": "0"
  }
}
```

Request sent:

```text
GET /api/v1/projects?status=active&level=0
```

Sample result:

```json
{
  "data": [
    {
      "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
      "ref": "PRJ-0003",
      "name": "Plant retrofit",
      "code": "PO-77812",
      "parent_id": null,
      "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "status": "active",
      "start_date": "2026-09-01",
      "end_date": "2026-12-31",
      "budget_hours": 1200,
      "bill_rate": 60,
      "level": 0
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/projects",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.8 get_project

Fetch one workforce project: parent, level, sub-projects, and the sites, employees and shifts it is linked to.

Calls `GET /api/v1/projects/{id}`. Scope: projects, read. REST reference: section 14.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Project id"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_project",
  "arguments": {
    "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c"
  }
}
```

Request sent:

```text
GET /api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c
```

Sample result:

```json
{
  "data": {
    "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
    "ref": "PRJ-0003",
    "name": "Plant retrofit",
    "status": "active",
    "level": 0,
    "parent": null,
    "sub_projects": [
      {
        "id": "f2d8b6c3-7a41-4e95-8b0d-4c9a1e7f2b0d",
        "ref": "PRJ-0003.1",
        "name": "Electrical works"
      }
    ],
    "links": {
      "site_ids": [],
      "employee_ids": [],
      "shift_ids": []
    }
  },
  "_links": {
    "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c"
  }
}
```

Row fields shortened; see section 14.2.

#### 25.4.9 get_project_hours

Worked hours for a project and everything beneath it over a date range -- the figure to invoice. Totals per project only; no per-employee detail.

Calls `GET /api/v1/projects/{id}/hours`. Scope: projects, read. REST reference: section 14.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Project id"
    },
    "from": {
      "type": "string",
      "description": "Start date, YYYY-MM-DD"
    },
    "to": {
      "type": "string",
      "description": "End date, YYYY-MM-DD (inclusive)"
    }
  },
  "required": [
    "id",
    "from",
    "to"
  ]
}
```

Sample call:

```json
{
  "name": "get_project_hours",
  "arguments": {
    "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
    "from": "2026-10-01",
    "to": "2026-10-31"
  }
}
```

Request sent:

```text
GET /api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/hours?from=2026-10-01&to=2026-10-31
```

Sample result:

```json
{
  "data": {
    "project_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
    "from": "2026-10-01",
    "to": "2026-10-31",
    "deduct_breaks": true,
    "total_minutes": 39300,
    "total_hours": 655,
    "breakdown": [
      {
        "project_id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
        "name": "Plant retrofit",
        "own_minutes": 12000,
        "total_minutes": 39300,
        "employees": 5,
        "employees_total": 11,
        "sessions": 40
      }
    ]
  },
  "_links": {
    "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/hours?from=2026-10-01&to=2026-10-31"
  }
}
```

#### 25.4.10 get_project_invoices

Invoices already raised from a project's hours: the period each covers, hours and amount billed, and the invoice's status. Use before billing a period to avoid billing it twice.

Calls `GET /api/v1/projects/{id}/invoices`. Scope: projects, read. REST reference: section 14.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Project id"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_project_invoices",
  "arguments": {
    "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c"
  }
}
```

Request sent:

```text
GET /api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices
```

Sample result:

```json
{
  "data": [
    {
      "invoice_id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
      "invoice_ref": "INV-2026-0113",
      "invoice_status": "draft",
      "period_from": "2026-09-01",
      "period_to": "2026-09-30",
      "granularity": "project",
      "minutes": 37200,
      "amount": 37200
    }
  ],
  "_links": {
    "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices"
  }
}
```

#### 25.4.11 create_project_invoice

Raise a draft invoice for a project's hours over a period, priced by the tenant's rate ladder (project rate, else employment-type rate, else workspace default). Pass dry_run=true to preview the lines without creating anything. Refuses a period already invoiced unless top_up=true bills only the hours added since.

Calls `POST /api/v1/projects/{id}/invoices`. Scope: projects, write. REST reference: section 14.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Project id"
    },
    "from": {
      "type": "string",
      "description": "Start date, YYYY-MM-DD"
    },
    "to": {
      "type": "string",
      "description": "End date, YYYY-MM-DD (inclusive)"
    },
    "granularity": {
      "type": "string",
      "enum": [
        "project",
        "sub_project"
      ],
      "description": "One line for the project, or one per sub-project"
    },
    "dry_run": {
      "type": "boolean",
      "description": "Preview only"
    },
    "top_up": {
      "type": "boolean",
      "description": "Bill only the hours added since the earlier invoice for this same period"
    }
  },
  "required": [
    "id",
    "from",
    "to"
  ]
}
```

Sample call:

```json
{
  "name": "create_project_invoice",
  "arguments": {
    "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
    "from": "2026-10-01",
    "to": "2026-10-31",
    "granularity": "project",
    "dry_run": true
  }
}
```

Request sent:

```text
POST /api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices
{"from":"2026-10-01","to":"2026-10-31","granularity":"project","dry_run":true}
```

Sample result:

```json
{
  "data": {
    "project": {
      "id": "e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c",
      "name": "Plant retrofit",
      "level": 0,
      "account_name": "Example Trading LLC"
    },
    "from": "2026-10-01",
    "to": "2026-10-31",
    "granularity": "project",
    "lines": [
      {
        "description": "Plant retrofit",
        "rate": 60,
        "source": "project",
        "minutes": 39300,
        "hours": 655,
        "amount": 39300
      }
    ],
    "subtotal": 39300,
    "tax": {
      "label": "VAT",
      "rate": 5,
      "inclusive": false,
      "amount": 1965
    },
    "total": 41265,
    "conflicts": [],
    "top_up": null,
    "blockers": []
  },
  "_links": {
    "self": "/api/v1/projects/e9c4a7b2-1f58-4d36-a0e7-5b8d2c1f3a0c/invoices"
  }
}
```

With dry_run omitted the call creates the draft and returns 201 { data: { id, ref, total, status: "draft" } }.

#### 25.4.12 query_project_hours

Worked hours attributed to projects, one row per work session over the last 12 months, each with the project (and its top-level project, level and account), minutes/hours, the bill rate that applies, the billable amount, and whether it is invoiced or unassigned. Aggregate with group_by and aggregates (e.g. group_by=project.name, aggregates=sum:hours) for hours by project, account or month; filter with from/to on date.

Calls `GET /api/v1/project-hours`. Scope: projects, read. REST reference: section 13.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Only sessions on this project (sub-projects have their own ids)"
    },
    "account_id": {
      "type": "string",
      "description": "Only sessions on projects for this account"
    },
    "filter": {
      "type": "string",
      "description": "Enriched filter, e.g. date>=2026-08-01,date<=2026-08-31"
    },
    "group_by": {
      "type": "string",
      "description": "e.g. project.name, top_project.name, account.name, employment_type, date (with group_period=month)"
    },
    "aggregates": {
      "type": "string",
      "description": "e.g. sum:hours,sum:billable_amount"
    }
  }
}
```

Sample call:

```json
{
  "name": "query_project_hours",
  "arguments": {
    "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
    "group_by": "project.name",
    "aggregates": "sum:hours"
  }
}
```

Request sent:

```text
GET /api/v1/project-hours?account_id=3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01&group_by=project.name&aggregates=sum%3Ahours
```

Sample result:

```json
{
  "data": [],
  "meta": {
    "count": 0,
    "total": 0,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z",
    "groups": [
      {
        "key": "Plant retrofit",
        "count": 84
      }
    ]
  },
  "_links": {
    "self": "/api/v1/project-hours",
    "next": null,
    "prev": null
  }
}
```

The endpoint reads `aggregate` (singular) and the filter grammar `field:op:value;...`. The manifest names the parameter `aggregates` and its example filter `date>=2026-08-01,date<=2026-08-31` is not that grammar, so a bridge that passes these through unchanged will not aggregate as described (verify). Use `aggregate=sum:hours` and `filter=date:gte:2026-10-01;date:lte:2026-10-31` over REST.

#### 25.4.13 list_products

List the tenant's sellable products (catalog): name, SKU, category and sub-category, unit of measure, list price, its quantity breaks (qty_breaks: from-quantity and rate bands above the list price, a null rate meaning priced normally), tax percent, status and item type (a stable key such as finished_product, raw_material, bom_kit; null when not classified). Optionally filter by category, sub_category, item_type or status.

Calls `GET /api/v1/products`. Scope: products, read. REST reference: section 12.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Only products in this category"
    },
    "status": {
      "type": "string",
      "description": "active or inactive"
    },
    "sub_category": {
      "type": "string",
      "description": "Only products in this sub-category"
    },
    "item_type": {
      "type": "string",
      "description": "Only products of this item type key (e.g. raw_material, bom_kit)"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_products",
  "arguments": {
    "category": "Motors",
    "status": "active"
  }
}
```

Request sent:

```text
GET /api/v1/products?category=Motors&status=active
```

Sample result:

```json
{
  "data": [
    {
      "id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a",
      "ref": "PRD-0014",
      "sku": "MOT-22-IE3",
      "name": "22 kW IE3 induction motor",
      "category": "Motors",
      "sub_category": "Induction",
      "item_type": "finished_product",
      "uom": "Nos",
      "list_price": 18500,
      "qty_breaks": [
        {
          "from": 5,
          "rate": 17800
        }
      ],
      "tax_percent": 5,
      "status": "active"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/products",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.14 get_product

Fetch one product by id, including description, quantity breaks (qty_breaks) and custom fields.

Calls `GET /api/v1/products/{id}`. Scope: products, read. REST reference: section 12.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Product UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_product",
  "arguments": {
    "id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a"
  }
}
```

Request sent:

```text
GET /api/v1/products/a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a
```

Sample result:

```json
{
  "data": {
    "id": "a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a",
    "ref": "PRD-0014",
    "sku": "MOT-22-IE3",
    "name": "22 kW IE3 induction motor",
    "description": "415 V, 4 pole, B3 foot mount",
    "list_price": 18500,
    "qty_breaks": [
      {
        "from": 5,
        "rate": 17800
      }
    ],
    "tax_percent": 5,
    "status": "active",
    "custom_data": null,
    "created_at": "2026-02-01T08:00:00.000000+00:00",
    "updated_at": "2026-09-12T08:00:00.000000+00:00"
  },
  "_links": {
    "self": "/api/v1/products/a85c2e71-0d94-4f3b-b6a8-1e7d3c9f5a0a"
  }
}
```

Row fields shortened; see section 12.

#### 25.4.15 list_opportunities

List the tenant's sales deals (pipeline): title, account, stage, outcome, amount, probability, expected close, owner. Optionally filter by stage, outcome, account_id or owner_id.

Calls `GET /api/v1/opportunities`. Scope: opportunities, read. REST reference: section 10.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "stage": {
      "type": "string",
      "description": "Only deals in this stage (e.g. qualify, propose, negotiate, won, lost)"
    },
    "outcome": {
      "type": "string",
      "description": "open, won, lost or dropped"
    },
    "account_id": {
      "type": "string",
      "description": "Only deals for this account"
    },
    "owner_id": {
      "type": "string",
      "description": "Only deals owned by this user"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_opportunities",
  "arguments": {
    "outcome": "open"
  }
}
```

Request sent:

```text
GET /api/v1/opportunities?outcome=open
```

Sample result:

```json
{
  "data": [
    {
      "id": "d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
      "ref": "OPP-0021",
      "title": "22 kW motor replacement programme",
      "account_id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "account_name": "Example Trading LLC",
      "stage": "propose",
      "outcome": "open",
      "amount": 41050,
      "probability": 50,
      "expected_close": "2026-12-01",
      "owner_id": "11111111-2222-4333-8444-555555555555"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/opportunities",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.16 get_opportunity

Fetch one deal by id, including its lines and the quotes created from it.

Calls `GET /api/v1/opportunities/{id}`. Scope: opportunities, read. REST reference: section 10.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Deal UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_opportunity",
  "arguments": {
    "id": "d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b"
  }
}
```

Request sent:

```text
GET /api/v1/opportunities/d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b
```

Sample result:

```json
{
  "data": {
    "id": "d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b",
    "ref": "OPP-0021",
    "stage": "propose",
    "outcome": "open",
    "amount": 41050,
    "lines": [
      {
        "sl_no": "1",
        "description": "22 kW IE3 motor",
        "qty": 2,
        "rate": 18500,
        "amount": 37000
      }
    ],
    "quotes": [
      {
        "object": "quotation",
        "ref": "QT-2026-0042",
        "status": "draft",
        "total": 41050
      }
    ]
  },
  "_links": {
    "self": "/api/v1/opportunities/d3b7f1a4-62e8-45c9-9d0b-7a2e4c6f8b0b"
  }
}
```

Row fields shortened; see section 10.2.

#### 25.4.17 list_rfqs

List the tenant's RFQs (requests for quotation sent to suppliers when no cost or price was found): ref, title, status, what each was raised from, reply deadline. Needs an API key explicitly scoped to "rfqs".

Calls `GET /api/v1/rfqs`. Scope: rfqs (explicit), read. REST reference: section 17.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "draft, sent, partially_replied, replied, awarded, closed or cancelled"
    },
    "origin_type": {
      "type": "string",
      "description": "What it was raised from: standard_quote, quote, opportunity, case, inspection_report, work_order, fence_project, pricing or manual"
    },
    "origin_id": {
      "type": "string",
      "description": "Only RFQs raised from this record"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_rfqs",
  "arguments": {
    "status": "sent"
  }
}
```

Request sent:

```text
GET /api/v1/rfqs?status=sent
```

Sample result:

```json
{
  "data": [
    {
      "id": "28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f",
      "ref": "RFQ-0012",
      "title": "Bearings for case CASE-0031",
      "status": "sent",
      "origin_type": "case",
      "origin_label": "CASE-0031",
      "respond_by": "2026-11-01",
      "required_by": "2026-11-10"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/rfqs",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.18 list_standard_quotes

List the tenant's standard quotes (the Standard Quotes module, separate from Quotations): ref, status (draft, sent, accepted, rejected, expired), customer account, validity, header discount, tax and shipping, subtotal and total, and how many lines each has, and the ERP invoices rolled up (invoice_count, invoiced_total, paid_total). Contacts are returned as an id only. Needs an API key scoped to "standard_quotes" (or to all objects).

Calls `GET /api/v1/standard-quotes`. Scope: standard_quotes, read. REST reference: section 19.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "draft, sent, accepted, rejected or expired"
    },
    "account_id": {
      "type": "string",
      "description": "Only quotes for this account"
    },
    "opportunity_id": {
      "type": "string",
      "description": "Only quotes linked to this deal"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_standard_quotes",
  "arguments": {
    "status": "sent"
  }
}
```

Request sent:

```text
GET /api/v1/standard-quotes?status=sent
```

Sample result:

```json
{
  "data": [
    {
      "id": "5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
      "ref": "SQ-0031",
      "status": "sent",
      "valid_until": "2026-11-20",
      "subtotal": 41050,
      "header_discount_pct": 0,
      "tax_pct": 5,
      "shipping_amount": 0,
      "total": 43102.5,
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Example Trading LLC"
      },
      "line_count": 2
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/standard-quotes",
    "next": null,
    "prev": null
  }
}
```

The manifest text mentions ERP invoice roll-ups on standard quotes; the standard quote list does not carry them (verify).

#### 25.4.19 list_sales_orders

List the tenant's sales orders (the Sales Orders module): ref, order type, status (draft, confirmed, cancelled), customer account, customer PO, pricing mode, subtotal, discount, tax, shipping and total, requested and expected delivery dates, what it was made from, and how many lines each has. Contacts are returned as an id only and a bill-to / ship-to as name and address only. Needs an API key scoped to "sales_orders" (or to all objects).

Calls `GET /api/v1/sales-orders`. Scope: sales_orders, read. REST reference: section 18.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "draft, confirmed or cancelled"
    },
    "account_id": {
      "type": "string",
      "description": "Only orders for this account"
    },
    "source_id": {
      "type": "string",
      "description": "Only orders made from this quote or deal"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_sales_orders",
  "arguments": {
    "status": "confirmed"
  }
}
```

Request sent:

```text
GET /api/v1/sales-orders?status=confirmed
```

Sample result:

```json
{
  "data": [
    {
      "id": "3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10",
      "ref": "SO-0004",
      "type": {
        "id": "4d8f2b96-0e35-4c71-b4a8-7f9c3e1d5a11",
        "name": "Standard order"
      },
      "status": "confirmed",
      "spine": "open",
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Example Trading LLC"
      },
      "customer_po": "PO-77812",
      "pricing_mode": "internal",
      "subtotal": 41050,
      "tax_total": 2052.5,
      "total": 43102.5,
      "requested_date": "2026-11-20",
      "expected_date": "2026-11-24",
      "line_count": 2
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/sales-orders",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.20 list_abm_programs

List the tenant's ABM (account-based marketing) programs: goal, time window, status and how many companies are targeted.

Calls `GET /api/v1/abm-programs`. Scope: abm_programs, read. REST reference: section 2.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "draft, active, paused, completed or archived"
    },
    "kind": {
      "type": "string",
      "description": "new_business or expansion"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_abm_programs",
  "arguments": {
    "status": "active"
  }
}
```

Request sent:

```text
GET /api/v1/abm-programs?status=active
```

Sample result:

```json
{
  "data": [
    {
      "id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
      "ref": "ABM-0002",
      "name": "Gulf contractors 2026",
      "kind": "new_business",
      "goal_metric": "deals_opened",
      "goal_target": 5,
      "status": "active",
      "targets_count": 12
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/abm-programs",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.21 get_abm_program

Fetch one ABM program by id with its funnel counted by company: targets, reached, engaged, in talks, in a deal, won, and the money linked to its deals.

Calls `GET /api/v1/abm-programs/{id}`. Scope: abm_programs, read. REST reference: section 2.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Program UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_abm_program",
  "arguments": {
    "id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13"
  }
}
```

Request sent:

```text
GET /api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13
```

Sample result:

```json
{
  "data": {
    "id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13",
    "name": "Gulf contractors 2026",
    "status": "active",
    "funnel": {
      "targets": 12,
      "reached": 9,
      "engaged": 6,
      "inTalks": 3,
      "deals": 2,
      "won": 1,
      "lost": 0,
      "dropped": 1
    },
    "money": {
      "openValue": 480000,
      "wonValue": 150000,
      "openDeals": 1,
      "wonDeals": 1
    }
  },
  "_links": {
    "self": "/api/v1/abm-programs/6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13"
  }
}
```

Row fields shortened; see section 2.2.

#### 25.4.22 list_abm_targets

List ABM target accounts (a company inside a program): tier, progress, next step and linked deal. Buying-group people are not listed. Needs an API key explicitly scoped to "abm_targets".

Calls `GET /api/v1/abm-targets`. Scope: abm_targets (explicit), read. REST reference: section 3.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "progress": {
      "type": "string",
      "description": "planned, reached, engaged, in_talks, deal_open, won, lost or dropped"
    },
    "tier": {
      "type": "string",
      "description": "one_to_one, one_to_few or one_to_many"
    },
    "program_id": {
      "type": "string",
      "description": "Only the companies of this program"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_abm_targets",
  "arguments": {
    "progress": "engaged",
    "program_id": "6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13"
  }
}
```

Request sent:

```text
GET /api/v1/abm-targets?progress=engaged&program_id=6f0b4d18-2a57-4e93-a6c0-9b1e5a3f7c13
```

Sample result:

```json
{
  "data": [
    {
      "id": "701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14",
      "program_ref": "ABM-0002",
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Example Trading LLC"
      },
      "tier": "one_to_one",
      "progress": "engaged",
      "next_step": "Site visit with procurement",
      "next_step_due": "2026-11-05",
      "people_count": 3
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/abm-targets",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.23 get_abm_target

Fetch one ABM target account by id with its buying group given as contact ids and roles only (no names, contact details or notes). Needs an API key explicitly scoped to "abm_targets".

Calls `GET /api/v1/abm-targets/{id}`. Scope: abm_targets (explicit), read. REST reference: section 3.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Target account UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_abm_target",
  "arguments": {
    "id": "701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14"
  }
}
```

Request sent:

```text
GET /api/v1/abm-targets/701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14
```

Sample result:

```json
{
  "data": {
    "id": "701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14",
    "account": {
      "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
      "name": "Example Trading LLC"
    },
    "tier": "one_to_one",
    "progress": "engaged",
    "buying_group": [
      {
        "contact_id": "5c8e7d10-2b9a-4f63-a1d4-8e0b3c7f9a02",
        "role": "decision_maker",
        "is_primary": true
      }
    ]
  },
  "_links": {
    "self": "/api/v1/abm-targets/701c5e29-3b68-4fa4-b7d1-0c2f6b4a8d14"
  }
}
```

Row fields shortened; see section 3.2.

#### 25.4.24 get_rfq

Fetch one RFQ by id with its lines, the suppliers asked, each supplier's quoted prices and which line was awarded to whom. Needs an API key explicitly scoped to "rfqs".

Calls `GET /api/v1/rfqs/{id}`. Scope: rfqs (explicit), read. REST reference: section 17.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "RFQ UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_rfq",
  "arguments": {
    "id": "28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f"
  }
}
```

Request sent:

```text
GET /api/v1/rfqs/28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f
```

Sample result:

```json
{
  "data": {
    "id": "28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f",
    "ref": "RFQ-0012",
    "status": "sent",
    "lines": [
      {
        "sl_no": 1,
        "description": "Deep groove ball bearing 6310-2RS",
        "qty": 40
      }
    ],
    "suppliers": [
      {
        "supplier_name": "Example Bearings FZE",
        "status": "replied"
      }
    ],
    "responses": [
      {
        "unit_price": 38.5,
        "currency": "AED",
        "lead_time_days": 7,
        "is_awarded": false
      }
    ]
  },
  "_links": {
    "self": "/api/v1/rfqs/28b3d7f9-5c16-4a40-9e82-0d1f6a3c7b0f"
  }
}
```

Row fields shortened; see section 17.2.

#### 25.4.25 get_standard_quote

Fetch one standard quote by id with its lines (description, quantity, rate, discount, amount, option group and whether it counts toward the total), introduction, notes and terms. Line margin checks, supplier-request links and contact details are never returned. Needs an API key scoped to "standard_quotes" (or to all objects).

Calls `GET /api/v1/standard-quotes/{id}`. Scope: standard_quotes, read. REST reference: section 19.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Standard quote UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_standard_quote",
  "arguments": {
    "id": "5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12"
  }
}
```

Request sent:

```text
GET /api/v1/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12
```

Sample result:

```json
{
  "data": {
    "id": "5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12",
    "ref": "SQ-0031",
    "status": "sent",
    "total": 43102.5,
    "intro_text": "Thank you for your enquiry.",
    "terms": "Valid for 30 days.",
    "lines": [
      {
        "sl_no": "1",
        "description": "22 kW IE3 induction motor",
        "qty": 2,
        "rate": 18500,
        "amount": 37000,
        "is_selected": true
      }
    ]
  },
  "_links": {
    "self": "/api/v1/standard-quotes/5e9a3c07-1f46-4d82-95b9-8a0d4f2e6b12"
  }
}
```

Row fields shortened; see section 19.2.

#### 25.4.26 get_sales_order

Fetch one sales order by id with its lines (description, printed text, quantity, unit price, discount, tax, line total, requested date, and the confirmed quantity and date with where that answer came from: the ERP or master data), notes and terms, and erp_documents: the invoices and deliveries the ERP reported for the order (number, date, due date, amount, currency, status), erp_checks: the latest Check with ERP result for credit, price and stock (status passed, warning, failed or not_run, a one-line reason, the time, and whether the lines changed since), and erp_transfers: each attempt to send the order to the ERP (time, result, ERP number, the step that failed). The creator, cancellation note, contact details and attachments are never returned. Needs an API key scoped to "sales_orders" (or to all objects).

Calls `GET /api/v1/sales-orders/{id}`. Scope: sales_orders, read. REST reference: section 18.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Sales order UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_sales_order",
  "arguments": {
    "id": "3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10"
  }
}
```

Request sent:

```text
GET /api/v1/sales-orders/3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10
```

Sample result:

```json
{
  "data": {
    "id": "3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10",
    "ref": "SO-0004",
    "status": "confirmed",
    "total": 43102.5,
    "lines": [
      {
        "line_no": 1,
        "description": "22 kW IE3 induction motor",
        "qty": 2,
        "unit_price": 18500,
        "line_total": 37000,
        "confirmed_qty": 2,
        "confirmed_date": "2026-11-24",
        "availability_source": "master"
      }
    ],
    "erp_documents": [],
    "erp_checks": [
      {
        "kind": "credit",
        "status": "passed",
        "message": "Within credit limit.",
        "stale": false
      }
    ],
    "erp_transfers": []
  },
  "_links": {
    "self": "/api/v1/sales-orders/3c7e1a85-9d24-4b60-a3f7-6e8b2d0c4a10"
  }
}
```

Row fields shortened; see section 18.2.

#### 25.4.27 list_estimates

List the tenant's project estimates: ref, name, status, customer, the template used and the price quoted to the customer before and after tax. Costs, margin and the bill of materials are internal and never returned. Needs an API key explicitly scoped to "estimates".

Calls `GET /api/v1/estimates`. Scope: estimates (explicit), read. REST reference: section 7.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "draft, quoted, won or lost"
    },
    "account_id": {
      "type": "string",
      "description": "Only estimates for this account"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_estimates",
  "arguments": {
    "status": "quoted"
  }
}
```

Request sent:

```text
GET /api/v1/estimates?status=quoted
```

Sample result:

```json
{
  "data": [
    {
      "id": "812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15",
      "ref": "EST-0009",
      "name": "Warehouse mezzanine, 400 m2",
      "status": "quoted",
      "currency": "AED",
      "quoted_total": 182500,
      "quoted_total_incl_vat": 191625,
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "ref": "ACC-0007",
        "name": "Example Trading LLC"
      },
      "template": {
        "name": "Steel structure"
      }
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/estimates",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.28 get_estimate

Fetch one project estimate by id: customer, template, status and quoted price (before and after tax). Never costs or margin. Needs an API key explicitly scoped to "estimates".

Calls `GET /api/v1/estimates/{id}`. Scope: estimates (explicit), read. REST reference: section 7.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Estimate UUID"
    }
  },
  "required": [
    "id"
  ]
}
```

Sample call:

```json
{
  "name": "get_estimate",
  "arguments": {
    "id": "812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15"
  }
}
```

Request sent:

```text
GET /api/v1/estimates/812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15
```

Sample result:

```json
{
  "data": {
    "id": "812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15",
    "ref": "EST-0009",
    "status": "quoted",
    "quoted_total": 182500,
    "quoted_total_incl_vat": 191625
  },
  "_links": {
    "self": "/api/v1/estimates/812d6f3a-4c79-4a15-88e2-1d3a7c5b9e15"
  }
}
```

Row fields shortened; see section 7.

#### 25.4.29 list_purchase_orders

List purchase orders raised to suppliers, optionally filtered by status or supplier.

Calls `GET /api/v1/purchase-orders`. Scope: purchase-orders, read. REST reference: section 15.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Filter by purchase order status",
      "enum": [
        "draft",
        "sent",
        "partially_received",
        "received",
        "cancelled"
      ]
    },
    "supplier_id": {
      "type": "string",
      "description": "Filter by supplier ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_purchase_orders",
  "arguments": {
    "status": "sent"
  }
}
```

Request sent:

```text
GET /api/v1/purchase-orders?status=sent
```

Sample result:

```json
{
  "data": [
    {
      "id": "14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e",
      "ref": "PO-2026-0057",
      "status": "sent",
      "supplier": {
        "id": "2e6a4c18-8f03-4b97-a1e5-d9c7b3f0a508",
        "name": "Example Bearings FZE"
      },
      "order_date": "2026-10-22",
      "expected_date": "2026-11-05",
      "total": 1540
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/purchase-orders",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.30 get_purchase_order

Get full purchase order detail including line items and receiving progress.

Calls `GET /api/v1/purchase-orders/{id}`. Scope: purchase-orders, read. REST reference: section 15.

Input schema:

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Purchase order ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "get_purchase_order",
  "arguments": {
    "id": "14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e"
  }
}
```

Request sent:

```text
GET /api/v1/purchase-orders/14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e
```

Sample result:

```json
{
  "data": {
    "id": "14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e",
    "ref": "PO-2026-0057",
    "status": "sent",
    "total": 1540,
    "lines": [
      {
        "description": "Deep groove ball bearing 6310-2RS",
        "qty_ordered": 40,
        "qty_received": 0,
        "rate": 38.5,
        "amount": 1540
      }
    ]
  },
  "_links": {
    "self": "/api/v1/purchase-orders/14a9e5c7-3b02-4d68-b7f1-9c6d0a2e8b0e"
  }
}
```

Row fields shortened; see section 15.2.

#### 25.4.31 list_invoices

List customer invoices with totals, paid amount and status. Optionally filter by status or account. For a Saudi e-invoicing workspace each row also carries einvoice_doc_type (standard, simplified, credit_note, debit_note) and einvoice_ready.

Calls `GET /api/v1/invoices`. Scope: invoices, read. REST reference: section 9.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Filter by invoice status",
      "enum": [
        "draft",
        "sent",
        "partial",
        "paid",
        "overdue",
        "cancelled"
      ]
    },
    "account_id": {
      "type": "string",
      "description": "Filter by account ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_invoices",
  "arguments": {
    "status": "overdue"
  }
}
```

Request sent:

```text
GET /api/v1/invoices?status=overdue
```

Sample result:

```json
{
  "data": [
    {
      "id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
      "ref": "INV-2026-0113",
      "status": "overdue",
      "account": {
        "id": "3f2a9c1e-7b44-4d0a-9a51-0c6d2e8b1a01",
        "name": "Example Trading LLC"
      },
      "due_date": "2026-10-15",
      "total": 41050,
      "paid_amount": 10000,
      "issued_at": "2026-09-15T08:00:00+00:00"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/invoices",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.32 get_invoice

Get full invoice detail including line items, balance due and payment history. For a Saudi e-invoicing workspace it also returns the document type, UUID, counter number, whether it is ready for e-invoicing, the original invoice and reason of a credit note, the supply date and each line's VAT category, rate and exemption reason.

Calls `GET /api/v1/invoices/{id}`. Scope: invoices, read. REST reference: section 9.

Input schema:

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Invoice ID"
    }
  }
}
```

Sample call:

```json
{
  "name": "get_invoice",
  "arguments": {
    "id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709"
  }
}
```

Request sent:

```text
GET /api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709
```

Sample result:

```json
{
  "data": {
    "id": "61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709",
    "ref": "INV-2026-0113",
    "status": "overdue",
    "total": 41050,
    "paid_amount": 10000,
    "balance_due": 31050,
    "lines": [
      {
        "description": "Supply of 3-phase induction motor 22 kW",
        "qty": 2,
        "rate": 18500,
        "amount": 37000
      }
    ],
    "payments": [
      {
        "amount": 10000,
        "paid_on": "2026-10-01",
        "method": "bank_transfer"
      }
    ]
  },
  "_links": {
    "self": "/api/v1/invoices/61f0a3d9-4b7c-4e25-8a16-c3d5e9b1f709"
  }
}
```

Row fields shortened; see section 9.2.

#### 25.4.33 list_employees

List staff records for this tenant — employee code, name, work email/phone, department, designation, employment dates, status. Personal data: the API key must be scoped to "employees" explicitly (the all-objects wildcard does not cover it), and the tenant must have the employees module enabled.

Calls `GET /api/v1/employees`. Scope: employees (explicit), read. REST reference: section 6.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Filter by status: active or inactive"
    },
    "department": {
      "type": "string",
      "description": "Filter by department"
    }
  }
}
```

Sample call:

```json
{
  "name": "list_employees",
  "arguments": {
    "status": "active",
    "department": "Workshop"
  }
}
```

Request sent:

```text
GET /api/v1/employees?status=active&department=Workshop
```

Sample result:

```json
{
  "data": [
    {
      "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16",
      "employee_code": "EMP-0042",
      "first_name": "Ravi",
      "last_name": "Menon",
      "email": "ravi.menon@example-trading.example",
      "department": "Workshop",
      "designation": "Technician",
      "status": "active",
      "employment_type": "full_time",
      "wfm_role": "employee"
    }
  ],
  "meta": {
    "count": 1,
    "total": 1,
    "page": 1,
    "limit": 50,
    "has_more": false,
    "generated_at": "2026-10-28T09:00:00.000Z"
  },
  "_links": {
    "self": "/api/v1/employees",
    "next": null,
    "prev": null
  }
}
```

#### 25.4.34 get_employee

Get one employee record by id, including any tenant-defined custom fields.

Calls `GET /api/v1/employees/{id}`. Scope: employees (explicit), read. REST reference: section 6.

Input schema:

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Employee id (UUID) as returned by list_employees"
    }
  }
}
```

Sample call:

```json
{
  "name": "get_employee",
  "arguments": {
    "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16"
  }
}
```

Request sent:

```text
GET /api/v1/employees/923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16
```

Sample result:

```json
{
  "data": {
    "id": "923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16",
    "employee_code": "EMP-0042",
    "first_name": "Ravi",
    "last_name": "Menon",
    "status": "active",
    "custom_data": null
  },
  "_links": {
    "self": "/api/v1/employees/923e7a4b-5d8a-4b26-99f3-2e4b8d6c0f16"
  }
}
```

Returns the complete employee row; fields shortened here, see section 6.2.

#### 25.4.35 list_tenders

List the tenant's tender deals: deal id and ref, title, customer, tender number, issuer, portal, bid end date, bid guarantee, change requests, go / no-go decision, stage, outcome and amount.

Calls `GET /api/v1/tenders`. Scope: tenders (explicit), read. REST reference: section 19A.1.

Input (all optional): `stage`, `outcome`, `decision` (`go` or `no_go`), `portal` (`ariba`, `email`, `excel` or `other`), `closing` (integer 1 to 365: only open tenders whose bid end date is within that many days).

Sample call:

```json
{ "name": "list_tenders", "arguments": { "outcome": "open", "closing": 14 } }
```

Request sent: `GET /api/v1/tenders?outcome=open&closing=14`. The result is the body shown in 19A.1.

#### 25.4.36 get_tender

Fetch one tender by id: the same fields as `list_tenders` plus a summary of its Bill of quantities (lines, priced, unpriced, stale, amount, file name and version).

Calls `GET /api/v1/tenders/{id}`. Scope: tenders (explicit), read. REST reference: section 19A.2. Input: `id` (required, the tender's deal uuid from `list_tenders`).

#### 25.4.37 get_tender_boq

The Bill of quantities of one tender, one row per line and paged, with `details` and `client_columns`. Cost, markup and supplier names are never returned.

Calls `GET /api/v1/tenders/{id}/boq`. Scope: tenders (explicit), read. REST reference: section 19A.3. Input: `id` (required), then optional `filter` (`field:op:value` triples joined by `;`), `search`, `sort`, `page` and `limit` (maximum 200).

Sample call:

```json
{ "name": "get_tender_boq", "arguments": { "id": "e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14", "filter": "status:eq:unpriced" } }
```

Request sent: `GET /api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/boq?filter=status:eq:unpriced`. The result is the body shown in 19A.3. Each row also carries `wbs_code` and `wbs_parts`, which say where the line sits in the tender's WBS.

#### 25.4.38 get_tender_wbs

The WBS (work breakdown structure) of one tender, one row per item in tree order and paged: code, name, parent, level (up to three), the owner's name, the number of BOQ lines, shared (split) lines and priced lines and the client amount, all rolled up from the sub-items, and `parts` (each BOQ line's share of that item with its quantity and client amount). The meta carries the whole-WBS total and what is still unassigned. Only client amounts: cost, markup and margin are never returned.

Calls `GET /api/v1/tenders/{id}/wbs`. Scope: tenders (explicit), read. REST reference: section 19A.4. Input: `id` (required, the tender's deal uuid), then optional `filter` (`field:op:value` triples joined by `;`, for example `level:eq:1` or `parent_code:eq:2`), `search` (text in an item's code or name), `sort` (a leading `-` is descending, for example `-client_amount`), `page` and `limit` (maximum 200).

Sample call:

```json
{ "name": "get_tender_wbs", "arguments": { "id": "e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14", "filter": "level:eq:1" } }
```

Request sent: `GET /api/v1/tenders/e4c8a2b6-91d3-4f07-b5a1-3d6f8e0a2c14/wbs?filter=level:eq:1`. The result is the body shown in 19A.4.

### 25.5 Tools that are announced but not built

- create_case — open a new service case
- update_case_status — advance case through the workflow
- create_quotation — create a new quotation with line items
- send_email — send a quotation or report by email
- send_whatsapp — send a message to a contact via WhatsApp Business API
- list_work_orders — list field work orders
- get_dashboard — get KPI summary

