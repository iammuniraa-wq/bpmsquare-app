# Tender BOQ on Data Workbench, v1 API and MCP — build spec

Owner request (2026-11-01, KAMCO): "keep it [the tender BOQ] connected with Data Workbench or API and MCP, in case we want to
pull it." This is a build spec for Sonnet builders: every file, function and column named here was read in the code on
2026-11-01 (branch `develop`). No migration, no SQL, no new table. No standard product file learns the word "tender" except
the registries that already list every object (bpmsquarecore 3b).

## 0. What is already there (checked)

| Surface | State |
|---|---|
| BOQ data | `tender_boq_sources` + `tender_boq_lines` (0223, SELECT-only RLS, every write is service role). A BOQ row's money lives on its deal line `opportunity_lines` (`line_id`): `qty`, `rate`, `amount`. Internal cost sits on the BOQ row: `unit_cost`, `markup_pct`; `price_source_ref` names the supplier / RFQ / past deal. |
| BOQ server | `src/lib/tender/boq/server.ts`: `openBoqRequest()` (the one gate: `gcc_tender` + `pipeline` + Pipeline workcenter view/edit + a tender deal of this workspace), `buildBoqState()`, `analyseUpload()` / `applyUpload()` (file in, diff by `item_key`, lines synced), `editBoqLine()`, `exportPriced()` / `exportAnswerSheet()`. Keys: `assignKeys()` / `baseKey()` in `parse.ts`; limits `BOQ_LIMITS` (2,000 lines, 15 MB). |
| Change log | Every BOQ write logs `objectType: "opportunity_tenders"` with fields `BOQ upload`, `BOQ rate <item>`, `BOQ rate source`, `BOQ cost <item>`, `BOQ price all` (the last two carry **cost and markup**). |
| OBJECT_FEATURE | `tenders`, `tender_boq_sources`, `tender_boq_lines` → `gcc_tender` already (`src/lib/objectFeatures.ts` 91-98). |
| v1 scope | `"tenders"` is in `EXPLICIT_SCOPE_ONLY` (`api/v1/_auth.ts` 112) and in the server-side `SCOPABLE_OBJECTS` of `api/settings/api-keys/route.ts` — but **not** in the client list `SCOPABLE_OBJECTS` of `settings/developer/ApiKeysPanel.tsx`, so nobody can tick it; and there is no `/api/v1/tenders` route. `LIST_SOURCES.tenders` exists (`src/lib/api/listSources.ts` 561) and is askable via `/ask` only with a key that names `tenders`. `changeFeedScope.ts` maps `opportunity_tenders → "tenders"`. |
| Deal lines on the API | `GET /api/v1/opportunities/{id}` already returns a tender's deal lines with `rate` and `amount` under the `opportunities` scope. The BOQ endpoints below add the BOQ metadata (item number, cost code, row, source, status), not new money. |
| Data Workbench | No `tender_boq_lines` object. Lines families follow `quote_lines` / `sales_order_lines`: static spec, parent by ref on Import, real `id` on Export, Update by `id` only. DW import posts `{ rows: [{rowNum, values}], fileName }` (DataWorkbenchClient.tsx 353-360); templates are built client-side from the spec (`buildTemplateCsv`). |
| MCP | `mcp-server/mcp.json` version `1.18.0`, 34 tools, none for tenders. |
| Docs | `docs/guides/api-and-mcp-reference.md` (sections 1.3, 1.4, 21, 24, 25.2-25.4 mention tenders as unreachable), website `C:\Users\Abdul Nandalpad\Documents\bpmsquare-site\api.html` (lines 149-152, endpoint table ~205-215, 271, 306, 323, 362), `docs/capabilities/gcc_tender.md`. |

## 1. The object

**Name:** Tender BOQ lines. Code name everywhere: `tender_boq_lines` (DW object id, LIST_SOURCES key, change-history
label unchanged: the BOQ stays logged on `opportunity_tenders`). **A row is** one line of a tender's Bill of quantities:
the `tender_boq_lines` row joined to its deal line, exactly as the BOQ screen shows it (`buildBoqState` → `BoqLineView`).

One field set on every surface (6b, one meaning per word; labels match the screen's `FIELD_LABEL`):

| key | label | from | DW Import | DW Export | DW Update | v1 / MCP |
|---|---|---|---|---|---|---|
| `id` | Record ID | `tender_boq_lines.id` | — | yes | match key | yes |
| `tender_ref` | Tender | deal `ref` (`OPP-####`) **or** `opportunity_tenders.tender_no` | required, resolves the parent | yes (deal ref) | — | `tender_id` + `tender_ref` + `tender_no` |
| `item_no` | Item no. | `item_no` | yes | yes | — | yes |
| `description` | Description | deal line `description` (else `file_description`) | required | yes | yes | yes (searchable) |
| `unit` | Unit | `file_uom` ?? line `uom` | yes | yes | — | yes |
| `quantity` | Quantity | line `qty` (else `file_qty`) | required | yes | yes | yes |
| `cost_code` | Cost code | `cost_code` | yes | yes | yes | yes |
| `rate` | Unit rate | line `rate` | yes = the client's own rate in the file (`file_rate`, becomes source `boq_rate`) | yes | **no** (a rate needs a source; the BOQ screen / price route is the one place) | yes |
| `amount` | Amount | line `amount` | — | export-only | — | yes |
| `rate_source` | Rate source | `price_source` code (`boq_rate`,`bom`,`past_project`,`supplier`,`manual`,`estimate`), `""` when unpriced | — | export-only | — | yes |
| `price_as_of` | Priced on | `price_as_of` | — | export-only | — | yes |
| `status` | Status | `priced` / `unpriced` / `stale` (priced, stale, not accepted — same rule as `totals.stale`) / `removed` (`removed_in_revision`) | — | export-only | — | yes |
| `row_no` | File row | `row_no` | — | export-only | — | yes |

**Internal, on no surface outside the BOQ screen:** `unit_cost`, `markup_pct`, `price_source_ref` (names the supplier /
RFQ / past deal), `stale_accepted`, `priced_by`, `priced_at`, `line_id`, `source_id`, `item_key`, `tenant_id`.
Reason: the rule the BOQ already lives by ("cost and margin never reach a file", `boqWiring.test.ts`) — a DW export is an
Excel that gets attached and forwarded exactly like the priced workbook, so it follows the same rule; v1 and MCP are
machine surfaces where a key, not a person, decides who reads (bpmsquarecore 3b-5 "internal-only columns stay internal").
No owner decision needed; if KAMCO later wants a cost export it is a new, admin-only, explicitly named column set.

## 2. Data Workbench — all three modes

Gate on every route, in this order (mirrors `openBoqRequest`): `requireTenantUser()` →
`assertObjectFeature(tenantId, "tender_boq_lines")` (literal string; `objectFeatures.test.ts` greps for it) →
`tenantHasFeature(supabase, tenantId, "pipeline")` else 404 → `resolvePermissions()` + `canViewWorkcenter(perms, "pipeline")`
(Export) / `canEditWorkcenter(perms, "pipeline")` (Import, Update) else 403 "You can view tenders but not change them".
Every BOQ write uses `createAdminSupabase()` (the tables have no write policy) with `.eq("tenant_id", tenantId)` on every
query; parents are loaded through `loadOpportunity()` + `loadTender()` by id, never trusted from the file.

### 2.1 Spec — `src/lib/import/tenderBoqLinesSchema.ts` (new, static like `salesOrderLinesSchema.ts`)

```ts
export const TENDER_BOQ_LINES_SPEC: ObjectSpec = {
  id: "tender_boq_lines", label: "Tender BOQ lines", icon: "≣",
  description: "Lines of a tender's Bill of quantities: add or revise lines of an existing tender by item number, or bulk-edit quantity, description and cost code on lines already there. Cost and markup are never in a file.",
  dependsOn: ["opportunities"],
  fields: [
    { key: "tender_ref", label: "Tender", type: "ref", required: true, hint: "Deal ID (OPP-0044) or the tender number of an existing tender", aliases: ["tender", "tender no", "tender number", "deal", "deal id", "opportunity"] },
    { key: "item_no", label: "Item no.", type: "text", hint: "The client's item number; a revised file matches lines by it", aliases: [/* copy EXACT.item_no from parse.ts */] },
    { key: "description", label: "Description", type: "text", required: true, hint: "Line description", aliases: [/* EXACT.description */] },
    { key: "unit", label: "Unit", type: "text", hint: "Nos · m · m² · m³ · kg · LS", aliases: [/* EXACT.uom */] },
    { key: "quantity", label: "Quantity", type: "number", required: true, hint: "Quantity in the client's file", aliases: [/* EXACT.qty */] },
    { key: "cost_code", label: "Cost code", type: "text", hint: "CSI / WBS / cost code", aliases: [/* EXACT.cost_code */] },
    { key: "rate", label: "Unit rate", type: "number", hint: "Only on Import: the client's own rate in the file. Our rate is set on the Bill of quantities", aliases: [/* EXACT.rate */] },
    { key: "amount", label: "Amount", type: "number", exportOnly: true, hint: "Computed quantity × rate" },
    { key: "rate_source", label: "Rate source", type: "text", exportOnly: true, hint: "boq_rate · bom · past_project · supplier · manual · estimate" },
    { key: "price_as_of", label: "Priced on", type: "date", exportOnly: true, hint: "Date of the price the rate came from" },
    { key: "status", label: "Status", type: "text", exportOnly: true, hint: "priced · unpriced · stale · removed" },
    { key: "row_no", label: "File row", type: "integer", exportOnly: true, hint: "Row in the client's workbook" },
  ],
  sampleRows: [ { tender_ref: "(Deal ID or tender number of an existing tender)", item_no: "1.1", description: "Example description", unit: "m³", quantity: "120", cost_code: "03 30 00" }, { tender_ref: "(Deal ID or tender number of an existing tender)", item_no: "1.2", description: "Example description 2", unit: "Nos", quantity: "4", rate: "250" } ],
};
export const TENDER_BOQ_UPDATE_KEYS = ["quantity", "description", "cost_code"] as const;
```
Export `EXACT` from `parse.ts` (currently module-private) so the aliases are the same list the upload's header detection uses — one source.
`rate` is not in `TENDER_BOQ_UPDATE_KEYS`: Update mode's spec builder (DataWorkbenchClient 211) keeps every non-export-only scalar, so the Update **route** ignores `rate` and reports it in the row outcome ("rate is set on the Bill of quantities, not by a file") — add that sentence as a comment next to the `visibleSpecs` filter in `DataWorkbenchClient.tsx` (the file's convention for deliberate exclusions).

### 2.2 Registries

- `src/lib/import/types.ts`: add `"tender_boq_lines"` to `ImportObjectId`.
- `src/lib/import/registrySchema.ts`: `REGISTRY_OBJECT_TYPE.tender_boq_lines: null` (static spec), `OBJECT_META.tender_boq_lines: { label: "Tender BOQ lines", icon: "≣", description: "", dependsOn: ["opportunities"] }` with the "never read, static spec" comment the other null entries carry. Nothing in `REFERENCE_FIELDS` / `REQUIRED_KEYS` (static spec).
- `src/app/(app)/data-workbench/page.tsx`: `"tender_boq_lines"` in `OBJECT_ORDER` after `"sales_order_lines"`; `STATIC_SPECS.tender_boq_lines = TENDER_BOQ_LINES_SPEC`; in the `objectOrder` filter add, next to the consents line, `if (id === "tender_boq_lines" && tenant?.features?.pipeline !== true) return false;` (the module key `gcc_tender` comes from `featureForObject`; the edition also needs the Pipeline, `tenderEnabled()` in `src/lib/tender/server.ts`).
- Change history: no change (`opportunity_tenders` is already in the filter dropdown, `tender/wiring.test.ts`).

### 2.3 Server refactor — `src/lib/tender/boq/server.ts` (keeps every existing export and test literal)

1. `boqRequestFor(ctx: { supabase; tenantId; userId; role; perms }, opportunityId, write)` — the body of `openBoqRequest()` after `requireTenantUser()` and the flag checks; `openBoqRequest()` becomes `requireTenantUser` + flags + `resolvePermissions` + `boqRequestFor`. The flag strings `"gcc_tender"`, `"pipeline"`, `canViewWorkcenter(perms, "pipeline")`, `canEditWorkcenter(perms, "pipeline")`, `loadOpportunity(admin, tenantId, opportunityId)` stay in this file verbatim (`boqWiring.test.ts` greps them).
2. `applyBoqLines(r, incoming: BoqLine[], source: { id: string; fileLabel: string })` — step 3 of `applyUpload()` (from `existingLines()` to the `logChange`) extracted; `applyUpload()` calls it after it stored the file and inserted the source row. Returns `{ added, changed, dropped, kept, priced_from_file }`. Keep the three insert literals `id: sourceId, tenant_id: tenantId, opportunity_id: opp.id`, `{ id, tenant_id: tenantId, opportunity_id: opp.id, sl_no`, `id: randomUUID(), tenant_id: tenantId, opportunity_id: opp.id, line_id` unchanged (tested).
3. `insertDwSource(r, { fileName, lineCount })` — a `tender_boq_sources` row for a file that came through Data Workbench: `version: previous+1`, `is_current: true` (previous set `is_current: false` first, same as upload), `file_name: safeFileName(fileName || "data-workbench.csv", "csv")`, `storage_path: ""`, `size_bytes: 0`, `sheet_name: "Data Workbench"`, `header_row: 1`, `header_labels: ["item_no","description","unit","quantity","cost_code","rate"]`, `column_map: { item_no: 1, description: 2, uom: 3, qty: 4, cost_code: 5, rate: 6 }`, `rate_col: null`, `amount_col: null`, `added_columns: false`, `total_row: null`, `uploaded_by: userId`. Reason for an empty `storage_path`: the column is NOT NULL and there is no workbook; the history and the "revised upload" diff stay honest.
4. `exportPriced()`: first line after `bundles()` — `if (!source.storage_path) return { ok: false, status: 422, error: "This Bill of quantities came from a Data Workbench file. Download the answer sheet instead." }`. The answer sheet needs no workbook and keeps working.
5. `editBoqLines(r, edits: { boqId: string; body: EditBody }[])` — loads `bundles(r)` **once**, applies each edit with today's `editBoqLine` rules, one `refreshOpportunityDerived` and one `logChange` (all changes) per call; returns per-edit outcomes `{ boqId, ok, error?, qty?, description?, amount? }`. `editBoqLine()` = `editBoqLines` with one edit (its tested `editPart` regex — no `file_qty|file_description|file_uom|file_rate` between `export async function editBoqLine` and `export type PriceAllResult` — must still hold: put `editBoqLines` **before** `editBoqLine`). `EditBody` gains `cost_code?: unknown` (trimmed, ≤ 60 chars, `null` when blank; patches `tender_boq_lines.cost_code`, never the deal line; logged as `BOQ cost code <item>`). The row panel route (`lines/[boqId]/route.ts`) is unchanged.
6. `linesFromRows(rows: { rowNum; values }[]): { lines: BoqLine[]; failed: RowOutcome[] }` in `parse.ts` (pure): `row_no = rowNum`, `item_no`, `description` (collapse spaces, ≤ 1000), `uom = values.unit`, `qty` via `parseNumber` (0 ≤ qty ≤ 9,999,999,999 else failed "Quantity out of range"), `cost_code`, `file_rate` via `parseNumber` (> 0 else null), then `assignKeys()`. More than `BOQ_LIMITS.maxLines` lines for one tender → the rest fail "Only the first 2,000 lines of a tender are read".

### 2.4 Routes (each mirrors `quote_lines`; tests in 2.6)

**`POST /api/import/tender_boq_lines`** (`src/app/api/import/tender_boq_lines/route.ts`)
Body `{ rows, fileName }` via `readImportBody`. Resolve parents once: `fetchAllRows(admin, "opportunity_tenders", "opportunity_id, tender_no", tenantId)` + `fetchAllRows(admin, "opportunities", "id, ref", tenantId)`; a map `nameKey(ref) → opportunity_id` and `nameKey(tender_no) → opportunity_id` (a tender number used twice is dropped from the map; rows naming it fail "Tender number is not unique — use the Deal ID"). A row whose `tender_ref` resolves to a deal with no tender row fails "… is not a tender". Group rows per tender; per tender: `boqRequestFor(ctx, oppId, true)` (403 → every row of that tender fails with its message), `linesFromRows`, `insertDwSource`, `applyBoqLines`. Response `ImportResponse` (its only statuses are inserted / skipped / failed): `added` rows → `inserted`; `changed` rows → `skipped` with reason `"Already on the tender — updated by item number"`; `unchanged` rows → `skipped` with reason `"Already on the tender — unchanged"`; everything else `failed` with its reason. Change log: `applyBoqLines` logs one `opportunity_tenders` entry per tender with field `"BOQ import (Data Workbench)"`, to `"<file> · N lines · a added, c changed, d removed, k kept"` (same shape as `BOQ upload`). Owner decision 2026-11-01: the import is ADD-AND-UPDATE ONLY (`applyBoqLines(..., { keepMissing: true })`): a line the file does not mention is never deleted or flagged. The remove-when-unpriced / keep-and-flag-when-priced rule belongs to the Upload BOQ screen alone.

**`POST /api/export/tender_boq_lines`** (`src/app/api/export/tender_boq_lines/route.ts`)
Body `{ filters }`. Rows = every tender of the workspace (`listTenders(admin, tenantId)`), for each `loadBoqRowsForApi(admin, tenantId, oppId)` (3.2, one shared loader so DW and v1 cannot drift), shaped to strings with the spec's keys plus `id` and `tender_ref` (deal ref). `applyFilters(rows, filters, typeByKey)` from `TENDER_BOQ_LINES_SPEC.fields`. Never selects `unit_cost`, `markup_pct`, `price_source_ref` (test 2.6).

**`POST /api/update/tender_boq_lines`** (`src/app/api/update/tender_boq_lines/route.ts`)
Body `{ rows }`. Each row needs `id` (else failed "Record ID is required to update a row"); patch keys from `TENDER_BOQ_UPDATE_KEYS` only (`rate`, `item_no`, `unit`, `tender_ref` present → outcome note "… is not changed by a file"). Look the ids up in one query `admin.from("tender_boq_lines").select("id, opportunity_id").in("id", ids).eq("tenant_id", tenantId)` (a foreign id matches nothing → failed "No record with id … found in this workspace"); group by `opportunity_id`; per tender `boqRequestFor(ctx, oppId, true)` then `editBoqLines(req, edits)`; map outcomes to `UpdateResponse` (`updated` / `skipped` "No change" / `failed` with the edit's error). Logged by `editBoqLines` (`BOQ quantity <item>`, `BOQ description <item>`, `BOQ cost code <item>`).

### 2.5 Template / spec
The template is built client-side from the spec, so the static spec IS the template; `exportOnly` fields are dropped from Import/Update automatically (DataWorkbenchClient 205-212). There are no `cf_` custom fields on BOQ lines (the table has no `custom_data`; a tender's custom fields sit on `opportunity_tenders`), so no spec builder is needed — say so in the commit.

### 2.6 Tests
- `src/lib/import/tenderBoqDw.test.ts` (new, the `salesOrderDw.test.ts` harness: `fakeDb`, mocked `requireTenantUser`, `tenantHasFeature`, `assertObjectFeature`, `permissions`): import creates lines + BOQ rows + a DW source with `storage_path ""`; a second import with a changed quantity updates by item number and logs one entry; export carries `id`, `tender_ref`, `status`, and no `unit_cost|markup_pct|price_source_ref` key; update by id changes `quantity` and recomputes `amount`, ignores `rate`, fails a foreign id; a tenant without `gcc_tender` gets 404, without `pipeline` 404, a viewer gets 403 on import/update.
- `src/lib/tender/boq/boq.test.ts`: `linesFromRows` (keys, limits, bad quantity).
- `src/lib/tender/boq/boqWiring.test.ts`: passes unchanged **if** the seven routes under `api/opportunities/[id]/boq` stay seven, the three insert literals stay, and `editBoqLines` sits above `editBoqLine`. Add one case: `exportPriced` refuses a source with an empty `storage_path`.
- `src/lib/objectFeatures.test.ts`: passes once each new DW route contains the literal `assertObjectFeature(tenantId, "tender_boq_lines")`.

## 3. v1 API (read-only)

Scope **`tenders`**, kept in `EXPLICIT_SCOPE_ONLY`: bid decisions, bond amounts, closing dates and now the rates we bid
are commercially sensitive, so a pre-existing `"*"` key (and the legacy `tenants.api_key`, whose scope is `["*"]`) never
gains them; a key must name `tenders`. Module gate: `authorizeApi(req, "tenders")` reads `OBJECT_FEATURE.tenders =
"gcc_tender"` (no change); each route additionally checks `tenantHasFeature(admin, tenantId, "pipeline")` → 404, as
`v1/opportunities/[id]` does.

### 3.1 Routes
- `GET /api/v1/tenders` — `src/app/api/v1/tenders/route.ts`: `authorizeApi(req, "tenders")`; rows = `LIST_SOURCES.tenders.load(tenantId)`; legacy filters `?stage=`, `?outcome=`, `?decision=`, `?portal=` (pushed as `legacyFilters`), and `?closing=<1..365>` applied before `enrichedList`: open tenders (`outcome` null or `"open"`) whose `closing_at` is between the start of today in the workspace time zone (`tenantToday(tenantId)`) and today + N days — the same meaning as the Tenders tab's `closing` filter (`src/lib/tender/filters.ts`). `enrichedList(req, rows, src.fields, { self: "/api/v1/tenders" })`. Each row keeps `_links.deal` and gains `_links.self` + `_links.boq`.
- `GET /api/v1/tenders/{id}` — `src/app/api/v1/tenders/[id]/route.ts`: non-UUID → 404; the one row of `LIST_SOURCES.tenders.load` with that id (404 when absent) plus `boq: { lines, priced, unpriced, stale, amount, file_name, version, uploaded_at } | null` from `loadBoqRowsForApi` (3.2) and `_links: { self, deal, boq }`.
- `GET /api/v1/tenders/{id}/boq` — `src/app/api/v1/tenders/[id]/boq/route.ts`: `authorizeApi(req, "tenders")`; 404 when the deal is not a tender of this workspace; `enrichedList(req, rows, TENDER_BOQ_LINE_FIELDS, { self: "/api/v1/tenders/${id}/boq", extraMeta: { source: { file_name, version, uploaded_at } | null } })` — paged by the query layer (`limit` ≤ 200), filterable (`?filter=status:eq:unpriced`), searchable on `description`. No BOQ → `data: []`, `meta.source: null`, 200.

### 3.2 Shared loader — `src/lib/tender/boq/apiRows.ts` (new, mirrors `src/lib/estimator/apiRows.ts`)
```ts
export const TENDER_BOQ_LINE_FIELDS: QueryableField[] = [ id, tender_id, tender_ref (searchable), tender_no (searchable), row_no (number), item_no (searchable), cost_code (searchable), description (searchable), unit, quantity (number), rate (number), amount (number), rate_source, price_as_of (date), status ];
export async function loadBoqRowsForApi(admin, tenantId, opportunityId): Promise<{ source: {...} | null; rows: Record<string, unknown>[] }>;
```
Reads `tender_boq_sources` (current) and `tender_boq_lines` with the explicit column list `id, line_id, row_no, item_no, cost_code, file_description, file_uom, file_qty, price_source, price_as_of, stale_accepted, removed_in_revision` (never `unit_cost`, `markup_pct`, `price_source_ref`, `*`), the deal's lines via `loadOpportunityLines`, `priceValidityDays(config)` + `tenantToday` for `status`; applies `relink` semantics read-only (a row whose `line_id` is not live reads from the file values and is `unpriced`). Every query `.eq("tenant_id", tenantId).eq("opportunity_id", opportunityId)`. Tolerates 0223 pending (`isMissingSchema` → `{ source: null, rows: [] }`).

### 3.3 Registries and surfaces
- `src/lib/api/registry.ts`: `"/api/v1/tenders"` in `UNDOCUMENTED_ENDPOINTS` (metadata + OpenAPI list/detail come free).
- `src/lib/api/openapi.ts`: after the `UNDOCUMENTED_ENDPOINTS` loop add `paths["/tenders/{id}/boq"]` explicitly (the loop only makes `/{id}`): `get`, tag `tenders`, `QUERY_PARAMS`, `listResponse()`, 404.
- `src/app/api/v1/route.ts` index: three lines — `"GET /api/v1/tenders": "List tenders (needs a key scoped to \"tenders\"): tender number, issuer, portal, bid end date, guarantee, go / no-go, stage, amount · filters: ?stage=, ?outcome=, ?decision=, ?portal=, ?closing=<days>"`, `"GET /api/v1/tenders/:id": "One tender with its BOQ summary (lines, priced, amount, file)"`, `"GET /api/v1/tenders/:id/boq": "The tender's Bill of quantities, one row per line: item number, cost code, description, unit, quantity, our unit rate and amount, where the rate came from and its status. No cost, markup or supplier name"`; append `tenders` to the `access_control` sentence's explicit list.
- `src/app/(app)/settings/developer/ApiKeysPanel.tsx` `SCOPABLE_OBJECTS`: `{ key: "tenders", label: "Tenders (bids and BOQ rates, no costs)" }` with the explicit-scope comment. **Do not touch** the server list in `api/settings/api-keys/route.ts` (`tenders` is already its last entry and `tender/wiring.test.ts` matches `/"tenders"\]/`).
- `src/lib/api/listSources.ts`: add `tender_boq_lines` **after the `estimates` entry** (not between `tenders` and `rfqs`: `tender/wiring.test.ts` slices that range and greps its selects): `label: "Tender BOQ lines"`, `description: "One row per line of a tender's Bill of quantities: item number, cost code, description, unit, quantity, our unit rate and amount, the rate's source and status. No cost or markup."`, `relatedWorkcenter: "pipeline"`, `fields: TENDER_BOQ_LINE_FIELDS`, `load` = `listTenders(admin, tenantId)` then `loadBoqRowsForApi` per tender (parallel in batches of 10), `_links.tender`. Scope for `/ask`: in `src/app/api/v1/ask/route.ts` line 51 extend the alias — `object === "project_hours" ? "projects" : object === "tender_boq_lines" ? "tenders" : object` — so BOQ questions need the explicit `tenders` scope, never the wildcard. (`objectFeatures.test.ts` "covers every queryable list source" passes: `tender_boq_lines` is mapped.) The in-app Report Builder gets the object for free, behind `canViewWorkcenter("pipeline")`.
- `src/lib/api/changeFeedScope.ts`: the feed already routes `opportunity_tenders` to `tenders`; add a prefix rule so the two BOQ log fields that carry cost never leave: `const INTERNAL_FIELD_PREFIXES: Record<string, string[]> = { opportunity_tenders: ["BOQ cost ", "BOQ price all"] }` applied in `stripInternalChangeFields` next to `INTERNAL_FIELDS` (`"BOQ cost <item>"` = a typed cost; `"BOQ price all"` = "… (markup 15% on costs)"). Also add `tender_boq_lines: "tenders"` to `SCOPE_FOR_TYPE` so a future direct log on the lines follows the scope.
- 3b-7 items that do not apply, say so in the commit: no nav/⌘K/search/Nova/analytics change — the BOQ is a tab of the tender record that already has all of them; no `custom_data`; no migration.

### 3.4 Tests
- `src/lib/tender/boq/apiExposure.test.ts` (new, the `productApiExposure.test.ts` shape): every `.from("tender_boq_lines").select("…")` in `apiRows.ts`, `listSources.ts`, the three v1 routes and the DW export route never contains `unit_cost`, `markup_pct`, `price_source_ref`, `priced_by` or `*`; `TENDER_BOQ_LINE_FIELDS` has no such path; `mcp.json` tool descriptions for the three tender tools contain no `cost|markup|margin|supplier name`; `src/app/api/v1/ask/route.ts` aliases `tender_boq_lines` to `tenders`; `ApiKeysPanel.tsx` offers `tenders`; the v1 index names the three endpoints; `registry.ts` lists `/api/v1/tenders`.
- `src/lib/api/changeFeedScope.test.ts`: `stripInternalChangeFields("opportunity_tenders", [...])` drops `BOQ cost 1.1` and `BOQ price all`, keeps `BOQ rate 1.1` and `BOQ upload`; `scopeForChangeType("tender_boq_lines") === "tenders"`.
- `src/lib/objectFeatures.test.ts`: `v1/tenders/route.ts` and `v1/tenders/[id]/route.ts` must contain `authorizeApi(` (the test scans one level); the recursive walk checks `[id]/boq/route.ts` names a mapped object (`"tenders"`).
- `src/lib/tender/wiring.test.ts`: unchanged, passes if 3.3's placement rules are followed.

## 4. MCP — `mcp-server/mcp.json`

Bump `"version": "1.18.0"` → `"1.19.0"`. Append after `get_employee` (keep the JSON valid; `productApiExposure.test.ts`
rejects the words `BOM components`, `bom_lines`, `rolled-up` anywhere in the file — write "product bill of materials" nowhere; say "estimate" instead):

```json
{ "name": "list_tenders",
  "description": "List the tenant's tender deals: deal id and ref, title, customer, tender number, issuer, portal, bid end date, bid guarantee, change requests, go / no-go decision, stage, outcome and amount. Needs an API key explicitly scoped to \"tenders\". Decision reasons, the source e-mail and costs are never returned.",
  "method": "GET", "path": "/api/v1/tenders",
  "inputSchema": { "type": "object", "properties": {
    "stage": { "type": "string", "description": "Only tenders in this stage (received, bid_no_bid, estimating, submitted, clarifications, awarded, bid_lost, no_bid)" },
    "outcome": { "type": "string", "description": "open, won, lost or dropped" },
    "decision": { "type": "string", "description": "go or no_go" },
    "portal": { "type": "string", "description": "ariba, email, excel or other" },
    "closing": { "type": "integer", "minimum": 1, "maximum": 365, "description": "Only open tenders whose bid end date is today or within this many days" } } } },
{ "name": "get_tender",
  "description": "Fetch one tender deal by id: the same fields as list_tenders plus a summary of its Bill of quantities (lines, priced, unpriced, stale, amount, file name and version). Needs an API key explicitly scoped to \"tenders\".",
  "method": "GET", "path": "/api/v1/tenders/{id}",
  "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "Deal UUID (the tender's id from list_tenders)" } }, "required": ["id"] } },
{ "name": "get_tender_boq",
  "description": "The Bill of quantities of one tender, one row per line and paged: item number, cost code, description, unit, quantity, our unit rate and amount, where the rate came from (boq_rate, bom, past_project, supplier, manual, estimate), the price date and the line status (priced, unpriced, stale, removed). Cost, markup and supplier names are never returned. Needs an API key explicitly scoped to \"tenders\".",
  "method": "GET", "path": "/api/v1/tenders/{id}/boq",
  "inputSchema": { "type": "object", "properties": {
    "id": { "type": "string", "description": "Deal UUID of the tender" },
    "filter": { "type": "string", "description": "field:op:value triples joined by ';', e.g. status:eq:unpriced or cost_code:like:03" },
    "search": { "type": "string", "description": "Text to find in the description, item number or cost code" },
    "sort": { "type": "string", "description": "Comma list, leading - is descending, e.g. row_no or -amount" },
    "page": { "type": "integer", "minimum": 1, "description": "1-based page" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 200, "description": "Rows per page, max 200" } }, "required": ["id"] } }
```

## 5. Slices (ordered; each ships and tests on its own)

| # | Slice | Files | Tests that gate it | Done when |
|---|---|---|---|---|
| 1 | **Server seam** | `src/lib/tender/boq/server.ts` (2.3 items 1-5), `parse.ts` (`linesFromRows`, export `EXACT`), `apiRows.ts` (3.2) | `boqWiring.test.ts` unchanged + new `exportPriced` case; `boq.test.ts` for `linesFromRows`; new `apiExposure.test.ts` part 1 (apiRows selects) | `npx tsc --noEmit` and `npx vitest run src/lib/tender` clean; the BOQ tab behaves exactly as before (upload, revise, price, row panel, downloads) on the demo tenant. |
| 2 | **Data Workbench** | `tenderBoqLinesSchema.ts`, `import/types.ts`, `registrySchema.ts`, `data-workbench/page.tsx`, `DataWorkbenchClient.tsx` (comment only), routes `api/{import,export,update}/tender_boq_lines/route.ts` | `objectFeatures.test.ts`, new `tenderBoqDw.test.ts` | On the demo tenant: Export a tender's BOQ → file has `id`, `tender_ref`, no cost columns; edit quantities in the file → Update changes the rows and the record's History shows them; Import a CSV with two new item numbers → they appear on the Bill of quantities with a new source version; a tenant without `gcc_tender` does not see the object. Check the DW object at 375 px (no new UI, only the list grows). |
| 3 | **v1 API + Talk to data + keys + change feed** | `api/v1/tenders/route.ts`, `[id]/route.ts`, `[id]/boq/route.ts`, `registry.ts`, `openapi.ts`, `v1/route.ts`, `ApiKeysPanel.tsx`, `listSources.ts`, `ask/route.ts`, `changeFeedScope.ts` | `objectFeatures.test.ts`, `changeFeedScope.test.ts`, `tender/wiring.test.ts`, `apiExposure.test.ts` part 2 | A key minted with `tenders` lists tenders, one tender, its BOQ paged and filtered; a `"*"` key gets 403; a workspace without the edition gets 404; `/api/v1/openapi.json` shows the three paths; `POST /ask { object: "tender_boq_lines" }` answers "unpriced lines over 10,000 on tender T-0012"; `/changes` with a `tenders` key shows BOQ rate changes and never a `BOQ cost` field. |
| 4 | **MCP** | `mcp-server/mcp.json` (3 tools, version 1.19.0) | `apiExposure.test.ts` part 3 (JSON parses, tools present, no cost words), `productApiExposure.test.ts` | Claude Desktop with the manifest and a `tenders` key answers "which BOQ lines of tender X are still unpriced". |
| 5 | **Docs** (after the owner validates slices 2-4 on KAMCO — memory rule "docs after testing") | `docs/guides/api-and-mcp-reference.md` (new "## 20. Tenders" with 20.1-20.3 and renumber 20-25 → 21-26; sections 1.3, 1.4, 21 ask list, 24 known gaps, 25.1 version, 25.2, 25.3 table + "37 tools", 25.4 three entries; drop every "tenders … unreachable (verify)" sentence); website `api.html` (lines 149-152 scope list and the "no endpoint" sentence, endpoint table rows for the three GETs, 271 ask list, 306 feed note, 323 webhook note, 362 MCP table row "Tenders"), `tenders.html` one line under the BOQ ("Export the BOQ from Data Workbench, read it over the API or MCP with a key scoped to tenders"); `docs/capabilities/gcc_tender.md` two rules ("The Bill of quantities is a Data Workbench object … cost and markup never in a file", "A key scoped to tenders lists tenders and reads a tender's Bill of quantities over the API and MCP; costs, markup and supplier names are never returned"); Drive "REST API — Integration Guide" snapshot bump | `catalog.test.ts` | Commit names the guides changed. |

Every slice ends with `npx tsc --noEmit` and `npx next build` clean, and the commit lists the 3b items with the deliberate
skips of 2.5 and 3.3.

## 6. Open questions for the owner

1. Import mode: the request was "pull it". Slice 2 builds all three modes because 3b-4 says so and a flat CSV of BOQ lines
   is a real KAMCO input (Excel without a usable layout). If Import is not wanted now, slice 2 ships Export + Update only
   and the comment in `DataWorkbenchClient.tsx` says why (like `rfqs`). Default: build all three.
