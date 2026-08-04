# BPMSquare REST API v1 — Quotations

> Full CRUD over quotations, with machine-readable metadata. Written 2026-08-04.
> Quotations are the only entity with write support so far; the structure
> generalises — see [Adding another entity](#adding-another-entity).

## 1. Authentication

Every request carries a **per-tenant API key** as a bearer token:

```
Authorization: Bearer <tenant API key>
```

The key both authenticates the caller *and* selects the tenant — there is no
account or tenant id in the URL. A key issued for Vikas Pioneers can only ever
see and touch Vikas Pioneers data.

**Generate one:** Admin → Tenants → *(the tenant)* → **External API key**.

> **The key grants writes, not just reads.** It can create, modify and delete
> quotations. Treat it like a password: don't put it in a shared Postman
> collection that syncs to the cloud, and regenerate it in Admin if it leaks.

Requests without a valid key get `401`:

```json
{ "error": "Unauthorized", "message": "Include header: Authorization: Bearer <tenant API key>. ..." }
```

## 2. Base URLs

| Environment | Base URL |
|---|---|
| Production — Vikas Pioneers | `https://vikas.bpmsquare.com/api/v1` |
| Production — Demo tenant | `https://app.bpmsquare.com/api/v1` |
| Staging | `https://bpmsquare-app-git-develop-munira1.vercel.app/api/v1` |

The host does **not** decide the tenant for API calls — the key does. Any host
serving the app will work; use the one matching the environment you mean to hit.

## 3. Discovering the schema

The API describes itself. Nothing below needs to be memorised:

```bash
curl -H "Authorization: Bearer $KEY" https://vikas.bpmsquare.com/api/v1/metadata/quotations
```

That returns every field with its type, description, allowed values, whether
it's required on create, and whether it's writable at all — plus the same for
nested line items, and the relations to accounts, contacts, assets and
inventory. `GET /api/v1/metadata` lists the documented entities;
`GET /api/v1` is the endpoint index.

This metadata is generated from the same definition that validates incoming
requests (`src/lib/api/quotes.ts`), so it cannot drift out of date.

## 4. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/quotations` | List. Filters: `?status=`, `?account_id=` |
| `POST` | `/quotations` | Create, with lines |
| `GET` | `/quotations/:id` | Detail — lines, account, contact, totals breakdown |
| `PATCH` | `/quotations/:id` | Update header and/or replace lines |
| `DELETE` | `/quotations/:id` | Delete |

### Create

```bash
POST /api/v1/quotations
```

```json
{
  "account_id": "8f976825-0000-0000-0000-000000000000",
  "name": "Rewinding of 180 kW motor",
  "quote_date": "2026-04-09",
  "valid_until": "2026-05-09",
  "type": "quotation",
  "gst_rate": 18,
  "lines": [
    { "sl_no": "1", "description": "Rewinding of 180 kW squirrel cage motor", "uom": "Nos", "qty": 1, "rate": 145000 },
    { "sl_no": "2", "description": "Dynamic balancing of rotor", "uom": "Nos", "qty": 1, "rate": 18000, "discount_pct": 10 }
  ]
}
```

`account_id` is the only required field. Everything else has a sensible default
(`type` → `quotation`, `status` → `draft`, `qty` → 1, `rate` → 0). The response
is `201` with the created quotation, including its server-generated `ref`
(Quote ID) and computed totals.

### Update

```bash
PATCH /api/v1/quotations/:id
```

Send only what changes:

```json
{ "status": "sent", "valid_until": "2026-06-30" }
```

**Lines are replaced wholesale.** Sending `lines` discards the existing set and
inserts what you sent — always send the complete array, never a partial one.
Omit the `lines` key entirely to leave lines untouched.

### Delete

```bash
DELETE /api/v1/quotations/:id
```

Returns `{ "data": { "id": ..., "ref": ..., "deleted": true } }`. The deletion is
recorded in the tenant's deletion log and in Change History, exactly as an
in-app delete would be.

## 5. Rules worth knowing before you script against it

**Money is always calculated server-side.** Sending `total` on a quotation, or
`amount` on a line, is a `422` — not silently ignored. The server computes:

```
line amount = qty × rate × (1 − discount_pct/100)
subtotal    = Σ amount of effective lines
total       = subtotal − header discount − material deductions
```

*Effective lines* excludes lines in an `alternative` group other than the one
named by `selected_option_id` — those are options the customer didn't take.

**Tax is not in the total.** `gst_rate` is applied at display and print time.
This has always been true in the app; the API reports it the same way. The
detail response includes a `totals` breakdown (`subtotal`, `discount`,
`deductions`, `total`) so you can reconcile.

**Unknown fields are rejected, not ignored.** A typo like `"quote_dat"` fails
with `422` naming the field and listing the accepted ones. This is deliberate:
a bulk load should fail on row 1, not silently drop a column across ten
thousand rows.

**Foreign ids are tenant-checked.** `account_id`, `contact_id`, `asset_ids` and
`inventory_item_id` must belong to your tenant, or the request is `404`.

**Line ordering is natural, not lexicographic.** `sl_no` is text (so `"1a"` and
`"2.10"` work), but reads sort it numerically — `1, 2, 10`, not `1, 10, 2`.

**Date profile.** A quotation carries five dates beyond `created_at`, and they
behave differently:

| Field | Behaviour |
|---|---|
| `quote_date` | The business date on the document. Yours to set; back-dating is fine. |
| `inquiry_date` | When the customer asked. Never auto-stamped — it precedes the quotation. |
| `submitted_at` | Auto-stamped the first time the quote leaves its initial status, and on an actual email send. **Send a value to override.** |
| `closed_at` | Auto-stamped when `outcome` leaves `open`; cleared if it returns to `open`. **Send a value to override.** |
| `updated_at` | System-maintained on every write. Read-only, including on import. |

The auto-stamps fire on `PATCH` only, never on `POST` — so a historical import
can state its own `submitted_at` and `closed_at` and the server will not
overwrite them. An explicit value always beats the auto-stamp.

**Every write is audited.** Creates, updates and deletes appear in
Administration → Change History with actor `api:v1`.

## 6. Errors

| Status | Meaning |
|---|---|
| `400` | Body isn't valid JSON |
| `401` | Missing or unrecognised API key |
| `404` | Quotation not found in your tenant, or a referenced id isn't yours |
| `422` | Validation failed — see `details` |
| `500` | Server or database error |

A `422` names every problem at once, so a bulk loader can fix a row in one pass:

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

## 7. Postman setup

1. Create an environment with `base_url` = `https://vikas.bpmsquare.com/api/v1`
   and `api_key` = the key from Admin.
2. On the **collection**, set Authorization → Bearer Token → `{{api_key}}`, so
   every request inherits it.
3. Set header `Content-Type: application/json` on the write requests.
4. Sanity-check with `GET {{base_url}}/metadata/quotations` before scripting.

To capture the id for follow-up requests, add this to the create request's
**Scripts → Post-response** tab:

```javascript
pm.environment.set("quote_id", pm.response.json().data.id);
```

## 8. Limits

- 200 lines per quotation per request.
- `PATCH` replaces lines wholesale; there is no per-line endpoint yet.
- No pagination on `GET /quotations` — it returns the tenant's quotations in
  one response. Fine at current volumes, will need cursors as data grows.
- No rate limiting on v1 endpoints yet.

## Adding another entity

The structure is entity-agnostic; quotations is simply the only one defined.

1. Write an `EntityDef` (see `src/lib/api/quotes.ts`) — fields, types,
   descriptions, required/read-only flags, relations, and any child entities.
2. Register it in `src/lib/api/registry.ts`.
3. Add routes that call `validateBody` / `validateChildren` and the shared
   response helpers in `src/app/api/v1/_auth.ts`.

Metadata, validation and the docs all follow from step 1 — there is no separate
schema to keep in sync.

### Key files

| File | Role |
|---|---|
| `src/lib/api/schema.ts` | Field types, validation engine, metadata generator |
| `src/lib/api/quotes.ts` | Quotation + quote-line definitions, totals calculation |
| `src/lib/api/quoteService.ts` | Tenant checks, line normalisation, response shaping |
| `src/lib/api/registry.ts` | Which entities are exposed |
| `src/app/api/v1/_auth.ts` | Bearer auth, CORS, error/response helpers |
| `src/app/api/v1/quotations/` | Collection and item routes |
| `src/app/api/v1/metadata/` | Self-description endpoints |
