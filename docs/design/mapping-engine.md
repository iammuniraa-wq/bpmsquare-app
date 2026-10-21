# Mapping engine: any BPMSquare object to any target, with value mapping

Design 2026-10-21. Extends `integration-middleware.md` (round-2 Mapping tab, section 9F),
`erp-connectors-sap-epromis.md` (adapter interface) and `webhooks-library.md` (Call webhooks).
Not built. Owner intent, verbatim:

1. "For the Mapping tab: show the BPMSquare API endpoint and pull all the fields; give one more
   API endpoint of the target system and fetch all the fields from there, propose a default
   mapping, let the user change it; then we will be 100% flexible for ever."
2. "That is value mapping: where do we keep the value-mapping subsection in the mapping tab? SAP
   C4C calls it code list mapping and it is used in any data sync at communication arrangement level."

## Decisions (taken with the owner, applied as defaults)
1. Mapping stays one of the four tabs (Links, Mapping, Monitor, Resync). It gets a two-way switch:
   **Fields** | **Value mapping**. No fifth tab.
2. Value lists are stored **once per connection** (the C4C communication-arrangement level) and
   reused by every document and inbound entity of that connection. One list per kind of value
   (Unit, Currency, Country, Payment terms, Incoterms, Status, plus user-defined), each a two-column
   table BPMSquare value | ERP code, used outbound and (reversed) inbound. A field row picks one
   list through a single "Convert with" choice. An unmapped outbound value is **never sent
   silently**: the message fails in the Monitor with a plain fix and Restart works after the fix.
3. Target schema sources, round 1: OpenAPI/Swagger URL, OData `$metadata`, pasted sample JSON.
   SOAP/WSDL later. Proposal is deterministic first (name + type); an optional AI step suggests
   the rest and the user confirms row by row. Numbers and prices that go out never come from AI.
4. Header and Lines are two blocks (the Lines block is the one nested array of the document).
5. The **call** (URL, method, auth, headers, timeout, where the response holds the readable id)
   is the Call-webhook definition. The mapping engine builds the webhook's body, so the webhooks
   library becomes the "any system" connector; Dynamics, SAP and ePROMIS are ready-made settings
   on top. Section 4 says exactly how the two stay in sync.
6. Dynamics 365 stays first. Today's preset maps in `tenant_connectors.config` keep working
   untouched; a workspace without a saved mapping document behaves exactly as today, and
   unflagged tenants see nothing.

## 1. Model

### Where it lives: two service-role tables, not `tenants.config`
A fetched schema is hundreds of fields per block (a Dataverse quote has 100+ attributes), kept
as a snapshot per document; a value list is edited row by row and imported from CSV; both need
versions. `tenants.config` is loaded by `getTenant()` on every request and shipped to the client
through `TenantProvider`, and `tenant_connectors.config` is read on every connector call, so
neither may grow by that much. A mapping also steers what the server sends to a third party, so
a member must never write it with their own session (the 2026-10-21 lesson): **RLS enabled, no
policy at all**, read and written only through `createAdminSupabase()` with `.eq("tenant_id",
tenantId)`. No secret is ever stored in either table (credentials stay on the connector or the
webhook, sealed), so nothing here needs `sealSecret`.

**Migration `supabase/migrations/0203_mapping_engine.sql`** (next after the webhooks 0202;
additive, idempotent, every block guarded; owner runs it by hand; bundle
`scripts/run-bundle-12-mapping-2026-10-21.sql` = 0203 then `scripts/seed-mapping-demo.sql`,
which seeds Unit and Currency lists for `is_demo` tenants only):

```sql
create table if not exists integration_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  connection_id text not null,            -- 'dynamics365' | 'sap' | 'epromis' | 'webhook:<uuid>'
  document text not null,                 -- 'quote' | 'customers' | 'contacts' | 'products' | 'projects' | later keys
  direction text not null check (direction in ('out','in')),
  version integer not null default 1,
  status text not null default 'active' check (status in ('active','previous')),
  doc jsonb not null,                     -- MappingDocument below (no credentials, ever)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid
);
create unique index if not exists integration_mappings_active_idx on integration_mappings (tenant_id, connection_id, document) where status = 'active';
create index if not exists integration_mappings_tenant_idx on integration_mappings (tenant_id, connection_id, document, version desc);
alter table integration_mappings enable row level security;   -- deliberately no policy

create table if not exists integration_value_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  connection_id text not null,
  kind text not null,                     -- 'unit' | 'currency' | 'country' | 'payment_terms' | 'incoterms' | 'status' | 'custom:<slug>'
  label text not null,
  rows jsonb not null default '[]'::jsonb,   -- [{ bpm, erp, inbound: boolean }]
  default_in text,                        -- BPMSquare value used when an inbound ERP code is unknown (null = keep the raw code)
  unknown_in jsonb not null default '[]'::jsonb,  -- last 50 unknown inbound codes seen, for the "unmapped" counter
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, connection_id, kind)
);
alter table integration_value_lists enable row level security;   -- deliberately no policy

-- Call webhooks can take their body from a mapping (guarded: only when 0202 has run).
alter table webhooks drop constraint if exists webhooks_payload_mode_check;
alter table webhooks add constraint webhooks_payload_mode_check check (payload_mode in ('standard','template','mapping'));
alter table webhooks add column if not exists mapping_id uuid references integration_mappings(id) on delete set null;
alter table webhooks add column if not exists response_key_path text;   -- '$.data.number': the readable id in the response
```

`src/lib/rlsPolicies.test.ts` gains 0203 in its replay list and asserts both tables have no
policy. No column is added to `tenants`. Degrade while pending: every mapping route answers
`{ needsDatabaseUpdate: true, bundle }` on `isSchemaPending` (42P01/42703/PGRST204/PGRST205);
the tab shows "Database update needed: run <bundle>"; dispatch and pull use today's preset path
(a missing table reads as "no mapping document"), never a crash.

### MappingDocument (`doc` jsonb; types in `src/lib/middleware/mapping/types.ts`, client-safe)
```ts
type MappingDocument = {
  source: { object: SourceObject;  /* "standard_quote" | "account" | "contact" | "product" | "project" */ registryHash: string };
  target: {
    kind: "adapter" | "openapi" | "odata" | "sample" | "manual";
    entity: string;                     // 'quotes', 'API_SALES_ORDER_SRV/A_SalesOrder', 'POST /v2/orders'
    linesPath: string | null;           // 'quote_details', 'to_Item', 'items'
    schema: { fetchedAt: string; sourceUrl: string | null; operation?: { method: string; path: string }; fields: TargetField[] };
  };
  header: MapRow[];
  lines: MapRow[];                      // empty when the target has no lines block
  note?: string;                        // the user's own one-liner
};
type TargetField = { path: string; label: string; type: FieldType; required: boolean; creatable: boolean; enum?: string[]; lookup?: string; state?: "new" | "missing" };
type FieldType = "text" | "integer" | "number" | "boolean" | "date" | "datetime" | "enum" | "lookup" | "array" | "object";
type MapRow = {
  id: string;                           // stable uuid per row
  target: string;                       // TargetField.path ('address.city', 'items[].qty' inside the lines block is just 'qty')
  source: string | null;                // BPMSquare field key incl. 'cf_*' and the block's own keys; null = constant-only or unmapped
  convert: Converter | null;            // section 4
  ifEmpty: string | null;               // default when the source is empty (after convert)
  origin: "standard" | "proposed" | "ai" | "user";
  confidence: "sure" | "likely" | "guess" | null;   // for proposed/ai rows, as words
};
```
The BPMSquare side is never snapshotted: it is computed live from `FIELD_REGISTRY` (+ the tenant's
`cf_*` custom fields via `getEffectiveFieldConfig`) and the v1 whitelist (`LIST_SOURCES`), so the
"BPMSquare API endpoint" in the owner's words is `GET /api/v1/<object>` and its fields are what
the engine offers. `registryHash` lets the tab say "BPMSquare gained 2 fields since this mapping"
without a save. For the Quote document the source keys are today's placeholders
(`QUOTE_PLACEHOLDERS`, `LINE_PLACEHOLDERS`, `PROJECT_PLACEHOLDERS`) plus the registry fields of
`quote` and the line fields of `StandardQuoteLine`, plus `cf_*`, plus `account.*` of the customer
(same names as the webhook tokens). Cost and margin fields are not offered on any outbound source
list (`products.cost_price`, internal cost breakdown), the same exclusion the webhook whitelist has.

### Versioning and "Reset to standard"
Every save inserts a new row with `version + 1` and flips the old active row to `previous` (kept,
last 10 per document, older pruned on save). `POST /mapping/restore { document, version }`
re-activates a previous version as a new one (nothing is ever edited in place). **Reset to
standard** deletes every row for (connection, document): the engine then reads the preset lane
exactly as today (Dynamics `D365_OUTBOUND_PRESETS` / `D365_DEFAULTS`, SAP and ePROMIS presets
from their adapters); a webhook connection has no preset, so Reset there re-runs the proposal
against the last snapshot and shows it unsaved.

### How today's Dynamics presets and composite rows fit
The preset lane is **not migrated**. `getMapping` returns, for a document with no active row, the
view it builds today from the connector config (`buildMappingView`), with `usingStandard: true`;
the first edit in the new Fields view materialises that view into a MappingDocument (rows with
`origin: "standard"`, composite templates such as `{ref} · {summary}` become `convert:
{ kind: "concat", parts: [{field:"ref"},{text:" · "},{field:"summary"}] }`, fixed `true` becomes
`{ kind: "constant", value: true }`) and saves it as version 1. From then on the engine is the
runtime for that document (section 6). `tenant_connectors.config.outbound` / `orders` /
`entities[].field_map` are left as they are and still drive the older `/api/settings/connectors`
screens on unflagged tenants; the inbound pull reads the active mapping row when present.

## 2. Schema discovery (target side)
`src/lib/middleware/schema/{types,openapi,odata,dataverse,sample,discover}.ts`, every parser pure
and tested; `discover.ts` is the only server file (fetch + cache + diff).

| Source | How | Limits |
|---|---|---|
| **adapter** (Dynamics today; SAP S/4, ePROMIS presets later) | `getErpMetadata` as today, extended: Dataverse picklists via `Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet` give `enum` values; lookups carry `lookup: <entity>`; `quote_details` is the lines block (entity `quotedetail`) | existing 60 s, cache 5 min |
| **openapi** (3.x and Swagger 2.0, JSON or YAML) | fetch the URL; pick the operation matching the call's method + path (path templates match `{id}` segments); take `requestBody.content.application/json.schema` (2.0: the `in: body` parameter); resolve local `$ref` only (cycle guard, depth 6), merge `allOf`, `oneOf` takes the first branch and notes it; `required[]` → required; `enum[]` → enum; the first array-of-objects property is offered as the lines block, others flatten to `a.b` paths | 5 MB, 20 s, 500 fields per block; if no operation matches, return `operations[]` and let the user pick |
| **odata** (`$metadata` of any OData v2/v4 service: SAP, F&O, BC, Gateway) | existing `parseODataMetadata` extended: `EnumType` members → enum; `NavigationProperty` of collection type → lines block candidates; `Nullable="false"` and keys → required; entity set chosen by name | 10 MB (F&O), 30 s, regex scan as today |
| **sample** (pasted JSON of a request body or a response row) | infer types from values; array of objects → lines block; nulls → text; nothing is required | 64 KB, depth 6 |
| **manual** | "Add a field": path + type (+ required). Same snapshot shape | 200 fields |

- **Refresh** = "Fetch fields" again: the new list is diffed against the snapshot; a field not seen
  before gets `state: "new"` (shown, unmapped, chip "3 new"); a mapped field no longer present gets
  `state: "missing"` (row kept, chip "1 missing", send validation fails with "`<field>` is no longer
  in the target: pick another field or remove the row"). **Nothing is dropped silently.**
- **SSRF**: a schema URL is saved only after `assertSafeHttpsUrl` (https, public address, DNS
  resolved) and fetched only through `fetchPublic` (re-resolved per hop, redirects refused).
  Adapter metadata goes through the adapter client, which already uses `fetchPublic`.
- **Credentials**: never in the mapping document. An adapter fetch uses the connection's sealed
  secret inside the adapter; a webhook connection's schema fetch may send that webhook's own sealed
  headers (unsealed inside `discover.ts` only, opt-in checkbox "Send the webhook's headers"); the
  stored `sourceUrl` must not contain a query string with a key (422 "Put the key in a header").
- **No readable schema** (ePROMIS until docs arrive, any closed system): paste a sample, or add
  fields by hand; both give the same snapshot and the same proposal. The tab says so in its empty
  state ("No field list yet: fetch one, paste a sample, or add fields").

## 3. Proposal (deterministic first, AI second)
`src/lib/middleware/mapping/propose.ts`, pure, replaces and absorbs `suggestMapping` in
`metadata.ts` (its SYNONYMS move here and grow).

1. **Normalise** both sides: lowercase; strip non-alphanumerics; strip a custom-prefix
   (`^[a-z]{2,8}\d*_`: `msdyn_`, `new_`, `cr1a2_`), strip `@odata.bind`, trailing `id`, `code`,
   `_value`, leading `_`; tokenise camelCase and snake_case.
2. **Score each (source, target) pair**, highest wins, each target used once (greedy by score,
   ties by name):
   - same normalised name → 1.0 **Sure**; same label → 0.95 **Sure**
   - synonym table hit (`name`: `fullname|displayname|organizationname|subject|searchname`;
     `email`, `phone`, `city`, `country`, `sku`: `productnumber|itemnumber|number|materialnumber`,
     `qty`: `quantity|orderquantity|requestedquantity`, `rate`: `priceperunit|unitprice|netprice`,
     `uom`: `unit|uomcode|salesunit|orderquantityunit`, `currency`: `transactioncurrency|currencycode|
     documentcurrency`, `total`, `valid_until`: `effectiveto|validto|expirydate`, `description`,
     `ref`: `externaldocumentnumber|customerreference|purchaseorderbycustomer`, ...) → 0.85 **Likely**
   - token Jaccard ≥ 0.5 with at least one shared token → 0.5–0.7 **Guess**
   - multiplied by **type compatibility**: same family 1.0; convertible 0.8 and the converter is
     attached (`text`→`number`/`integer`: `number`; `date`→`text`: `date` with the target's
     pattern; `text`/enum→`enum`: `value_list`); incompatible (`array`, `object`, `lookup` vs a
     scalar) 0 → never proposed.
3. **Required flagging**: required target fields with no row go to `missingRequired` and the one
   bar; the engine's own contract fields (`ALWAYS_HEADER` / `ALWAYS_LINES` for Dataverse; the
   adapter's list otherwise) are excluded as today.
4. **Enum targets** propose a value list: kind by name (`uom|unit` → unit, `currency` → currency,
   `country`, `paymentterms`, `incoterms`, `status|statecode`), else `custom:<target path>`; rows
   are the target's enum values matched by normalised name to BPMSquare's own values
   (`UOM_OPTIONS`, ISO 4217 codes, country names, the quote statuses) — unmatched ERP values are
   listed with an empty BPMSquare side; the list is created as a **proposal** the user saves.
5. Rows arrive with `origin: "proposed"` and the confidence word; the screen shows Sure and Likely
   as filled, Guess with a dotted underline; all editable; Save keeps what is shown.

**AI step** (`POST /mapping/propose-ai`): button "Ask AI for the unmapped rows", visible only when
`features.ai_assistant` is on and `aiConfigured()`; gated and metered through `callStructured` in
`src/lib/ai/structured.ts` with surface `"mapping"` (monthly allowance checked before, usage
logged after, same as the other AI surfaces). **What is sent**: source field keys, labels and
types (custom fields as their labels), target paths, labels, types, required marks and enum
values, and the deterministic result; **never a record, a value, a URL or a credential**. The
schema the model must return is `[{ source, target, reason }]` for unmapped targets only; any
`convert`, constant or number in the answer is discarded (prices and numeric scales come from the
user, never from AI). Returned rows show in a review list with the reason, each with Accept / Skip;
accepted rows become `origin: "ai"`, confidence "AI"; nothing is saved until the user presses Save.

## 4. Row converters (closed set, no code)
`src/lib/middleware/mapping/convert.ts`, pure, each with the test vectors below in `convert.test.ts`.
A row has at most one converter plus `ifEmpty`. Scripting (JavaScript, expressions, formulas) is
**deliberately not supported**: a tenant-typed program would run on our server for every send,
cannot be made safe by a whitelist, and cannot be explained in a Monitor fix line. Everything a
real integration needed so far fits the eight below; a ninth is a product change, not a tenant one.

| kind | params | in → out (test vectors) | inbound (reverse) |
|---|---|---|---|
| `value_list` | `list: kind` | `"Mtr"` → `"M"` (row Mtr=M); `"Box"` with no row → **problem `value_unmapped`** | `"M"` → `"Mtr"` (the row marked inbound, else first); unknown → `default_in` or raw |
| `constant` | `value: string|number|boolean` | source ignored; `true` → `true`; `"ZZ"` → `"ZZ"` | not reversible: refused on an inbound row (422) |
| `concat` | `parts: ({field}|{text})[]`, max 6; `skipEmpty: boolean` | `[{field:"ref"},{text:" · "},{field:"title"}]` with SQ-0012 / Fence → `"SQ-0012 · Fence"`; title empty + skipEmpty → `"SQ-0012"` | not reversible |
| `split` | `sep: string; index: number (0-based, -1 = last)` | `"SQ-0012"` sep `-` index 1 → `"0012"`; index 5 → empty (then `ifEmpty`) | not reversible |
| `date` | `format: "iso-date"|"iso-datetime"|"dd.MM.yyyy"|"dd/MM/yyyy"|"MM/dd/yyyy"|"yyyyMMdd"|"epoch-ms"` | `"2026-10-21"` → `"21.10.2026"`; `"2026-10-21T10:00:00Z"` iso-date → `"2026-10-21"`; unparsable → problem `bad_date` | yes: parse the format back to ISO |
| `number` | `scale: number (×); decimals: 0..6; asText: boolean` | `12.5` scale 100 decimals 0 → `1250`; `19.999` decimals 2 → `20`; asText → `"20.00"`; `"abc"` → problem `bad_number` | yes: divide by scale |
| `text` | `op: "trim"|"upper"|"lower"|"truncate"; max?: number` | `"  Fence "` trim → `"Fence"`; upper → `"FENCE"`; truncate 3 → `"Fen"` | trim only |
| `boolean` | `trueValue, falseValue` | `true` → `"X"` / `false` → `""` (SAP style); `"Y"`/`"N"` | yes: equal to trueValue |

`ifEmpty` applies after the converter; a required target field that is still empty after `ifEmpty`
is a problem `required_empty` ("`<field>` is required by the target and `<source>` is empty").

## 5. Value mapping in detail
- **Data**: `integration_value_lists` above. `rows[]` = `{ bpm, erp, inbound }`; `bpm` unique per
  list outbound (one BPMSquare value → one code); the same `erp` may appear on several rows
  (many-to-one outbound); exactly one of them carries `inbound: true` (the reverse answer); the
  screen enforces it with a radio in the "In" column and the save route 422s otherwise.
  `default_in` is the BPMSquare value for an unknown inbound code; null = keep the raw code.
- **Standard kinds** (fixed keys, labels translatable): unit, currency, country, payment_terms,
  incoterms, status; **user-defined** kinds `custom:<slug>` with a label (max 20 per connection).
- **Proposed rows** come from section 3 step 4 and from "Propose from target" on the list screen
  (uses the enum values of every target field in the connection's snapshots that has the matching
  kind). BPMSquare values of the standard kinds come from `UOM_OPTIONS`, the tenant's currency
  settings and ISO 4217, ISO 3166 names, the Standard Quote statuses; for a custom kind the user
  types them or imports CSV.
- **Counters** on each list card: `n rows · k unused · m unmapped`. *Unused* = rows whose `bpm`
  value no field row references through a `value_list` converter in any document of the
  connection (computed on read). *Unmapped* = distinct values seen that have no row: outbound from
  the last 30 days of `failed` Monitor rows with `summary.kind = "mapping_value"` (no extra table),
  inbound from `unknown_in`. A tap on the counter lists the values with an "Add row" shortcut.
- **Outbound failure**: `run()` returns problem `{ code: "value_unmapped", list, value, field }`;
  dispatch records the message `failed`, `restartable: true`, headline **"Unit 'Mtr' has no ERP
  code."**, fix **"Add it in Mapping > Value mapping, then Restart."**; with several values in one
  send, one message lists them all ("Unit 'Mtr', 'Box' have no ERP code."). Restart re-reads the
  lists and re-runs the same claim (idempotent as today).
- **Inbound**: the pull maps ERP → BPMSquare through the row marked inbound; an unknown code →
  `default_in` if set, else the raw code is stored and the code is appended to `unknown_in`
  (capped 50, distinct). A pull never fails on a value; the Monitor run row carries "3 unknown
  unit codes" in its summary.
- **CSV**: Export (`GET /value-lists/<kind>/csv`, columns `bpm_value,erp_code,inbound`, cells
  through `csvCell`); Import (`POST …/csv`, ≤ 2 000 rows, parsed with `src/lib/import/parse.ts`)
  replaces the whole list after a preview `{ added, changed, removed }` the user confirms.
- **Deleting a list** used by a field row is refused (409 naming the document and field).

## 6. Runtime
`src/lib/middleware/mapping/engine.ts` (pure) and `engineServer.ts` (loads rows, tenant-scoped).
- `compile(doc, lists) → Program | { errors }`: validates every row against the snapshot (unknown
  target path, missing field, type mismatch without converter, inbound row with an outbound-only
  converter, list kind that does not exist) and builds a flat list of `(target path, getter)`.
- `run(program, record: SourceRecord) → { header, lines, problems }`: `SourceRecord` is built by
  `sourceRecord.ts` from the same loaders the webhooks use (`loaders.ts`: Standard Quote with
  lines and account, decrypted PII only where whitelisted) plus `custom_data` as `cf_*`. Problems
  are collected, never thrown; a problem row is left out of the body.
- **Dispatch** (`dispatch.ts`): before building, `loadActiveMapping(admin, tenantId, connection,
  "quote")`; when present, `run()` yields the header and lines and `buildDataverseQuote` /
  `buildProjectBody` take them as a **prebuilt body** and still apply the contract steps that no
  mapping may remove (customer/price list/currency binds, the `[bpmsquare:<id>]` marker, the ref
  prefix on the name, `uomid` stripped on write-in lines, `isproductoverridden`). Absent → today's
  `outboundConfig` path, byte for byte (`dispatch.test.ts` asserts it).
- **Webhook sender** (`src/lib/webhooks/sender.ts`): `payload_mode === "mapping"` → load the
  webhook's `mapping_id` (tenant-verified), `run()`, body = `{ ...header, [linesPath]: lines }`
  (no lines block → header only); then sign and send exactly as the other modes. After a 2xx,
  `response_key_path` (a plain `$.a.b[0].c` path, no expressions) reads the readable id from the
  response and stores it as `connector_links.external_key` for the `webhook:<id>` connection, so
  the ExternalRecordLine shows it. **Keeping the two in sync**: the mapping is the only store; the
  webhook row holds a pointer; the webhook panel's Request tab in mode "mapping" shows "Body from
  Mapping: Quote → <webhook name>" with an "Open mapping" link and a read-only **generated template**
  (the body with `{{source}}` tokens in place of values, derived on read, never stored). Deleting
  the mapping sets the webhook back to `standard` and flags it "needs attention".
- **Pull** (`connectors/d365/syncPull.ts` and the later adapters): when an active inbound mapping
  exists, `mapPullRow` runs the inbound rows (reverse converters) instead of `field_map`.
- **Validation before save** (`PUT /mapping`): the same `compile()`; errors are returned per row
  (422 `errors[{ rowId, message }]`); `missingRequired` is a warning bar, not a blocker (today's
  behaviour); a document with a "missing in target" mapped row saves but cannot send (send-time
  problem `target_field_missing`).
- **Try it** (`POST /mapping/try { document, record_id? }`): the Links "Try it" preview reused
  (`previewQuote` in `ops.ts`), now through the engine: `{ words: string[], request: { method, url,
  headers: string[] /* names only */, body }, problems: Problem[] }`; with no `record_id` the ZZ
  sample quote is used. The exact body the target would get, with converters and lists applied;
  an unmapped value appears in `problems`, not as a thrown error.
- **Monitor**: problems become the row's `fix`; `classifyIntegrationRow` learns
  `summary.kind = "mapping_value" | "mapping_invalid"`; both are `restartable`.

## 7. Screen (bpmsquarecore 6b; InfoTips in `settings/middleware/tips.ts`, held by `tipTextProblems`)

```
Mapping (i)                     [ Quote → Dynamics Quote ▾ ]      ( Fields | Value mapping )
Target fields: 112 · fetched Today 14:02 · 3 new   [ Fetch fields ]  Propose ▾   Reset to standard
┆ The ERP needs Price list and nothing fills it yet. Pick a field below, or reset to standard. ┆
Header data
┌──────────────────────────────┬─────────────────────────────────┬───────────────────┐
│ BPMSquare field              │ ERP field                       │ Convert           │
├──────────────────────────────┼─────────────────────────────────┼───────────────────┤
│ Reference · ref              │ Name · name ▾                   │ –                 │
│ Reference, Summary  Standard │ Description · description       │ Join              │
│ Currency · currency          │ Currency · currencycode ▾  Sure │ Currency list ▾   │
│ Valid until · valid_until    │ Effective to · effectiveto ▾ Guess│ Date dd.MM.yyyy ▾ │
│ Site code · cf_site_code     │ Not sent ▾                      │                   │
└──────────────────────────────┴─────────────────────────────────┴───────────────────┘
Lines (quote_details)
│ Unit · uom                   │ Unit · uomcode ▾         Likely │ Unit list ▾       │
│ Quantity · qty               │ Quantity · quantity ▾           │ –                 │
                                                        [ Try it ]   [ Save mapping ]
```
- **One compact bar** under the title holds everything about the target schema: count, fetched
  time, new/missing chips, **Fetch fields**. For an adapter connection the bar says "fetched
  automatically" and Fetch fields re-fetches (today's `refresh=1`). For a webhook ("any system")
  connection the bar opens a small popover: source (OpenAPI URL | OData $metadata URL | Paste a
  sample | Add fields), the URL field, the "Send the webhook's headers" tick, Fetch. Nothing else
  on the page explains schemas; the (i) beside the title does.
- **Propose ▾**: "Propose by name" (deterministic, fills empty rows only; "Replace all" is a second
  item with a confirm) and, when AI is available, "Ask AI for the unmapped rows" → review sheet.
- The third column shows only on a row that has a converter or whose target is an enum/date/
  number mismatch; otherwise it is "–" and a tap opens the converter sheet (kind dropdown, its
  one or two params, `ifEmpty`, and a live example "Mtr → M" from the ZZ sample). Confidence words
  (Sure / Likely / Guess / AI) appear once, small and muted, and disappear on the first edit.
- Composite standard rows render read-only with the word Standard as today; a tap offers "Edit as
  Join", which materialises the document (section 1).
- **Value mapping view**:
```
( Fields | Value mapping )                 Lists for Dynamics 365 (i)        [ New list ▾ ]
┌ Unit · 11 rows · 2 unused · 1 unmapped ───────────────────────────── CSV ▾ ┐
│ BPMSquare value │ ERP code │ In │        Default for unknown inbound: Nos ▾ │
│ Nos             │ EA       │ ●  │                                            │
│ Mtr             │ M        │ ●  │                                            │
│ Metre           │ M        │ ○  │                                            │
│ Box             │          │    │  ← needs a code (shown in red)             │
│ + Add row       Propose from target                                          │
└──────────────────────────────────────────────────────────────────────────────┘
┌ Currency · 3 rows ───────────────────────────────────────────────────────────┐
```
  One card per list, collapsed to its header line except the one open; "New list" offers the
  standard kinds not yet created and "Custom…". The "unmapped" counter opens the list of values
  with "Add row". Empty state: "No value lists yet. Propose from target, or New list."
- **375 px**: one column; each field row stacks (BPMSquare label; ERP select; converter chip);
  the schema bar wraps to two lines; the view switch is a segmented control full width; Save and
  Try it in the sticky footer; the converter sheet and the AI review are bottom sheets; tap targets
  ≥ 44 px; no horizontal scroll (the value table drops the In column into a row menu).
- **Empty states**: no connection → "Connect a system first" (link to the chip); no target schema
  → "No field list yet: fetch one, paste a sample, or add fields" with the bar's button; no lists
  → as above.
- Tips (new keys, two sentences, ≤ 160 chars): `mappingFields`, `valueMapping`, `convert`,
  `fetchFields`, `propose`, `proposeAi`, `listInbound`, `tryIt`.

## 8. Security and multi-tenancy; tests; SQL
**Checklist**
- Every route under `/api/middleware/mapping*` and `/api/middleware/value-lists*` starts with the
  existing `guard()` (admin, flag, tenant from the session only); every query on both new tables
  `.eq("tenant_id", tenantId)`; both tables RLS-enabled with no policy (`rlsPolicies.test.ts`).
- `connection_id`, `mapping_id`, `webhook_id`, `record_id` from a body are verified against the
  tenant before use (`.eq("id", x).eq("tenant_id", tenantId).maybeSingle()`); a miss is 422/404.
- Schema URLs: `assertSafeHttpsUrl` on save, `fetchPublic` on fetch, https only, no key in a query
  string; size and time caps per source; YAML parsed with a safe loader (no custom tags).
- No credential in `integration_mappings`, `integration_value_lists`, the Try it answer (header
  names only), the Monitor payload (`redactPayload` as today) or the change-log diff.
- Converters are data, never code; the engine has no `eval`, no template language, no regex from
  tenant input (`split.sep` is a literal); `response_key_path` is a literal path parser.
- AI: field names and types only; no record values; metered; output restricted to pairs.
- Outbound source lists exclude cost/margin fields; PII fields decrypt only through the existing
  whitelisted loaders and only when the webhook's `allow_personal_data` is on (adapter sends are
  the ERP's own customer data as today).
- Change history: `logChange` on mapping save/restore/reset and on value-list save/import/delete
  (`objectType "integration_mapping"` and `"value_list"`, diff = row counts and changed paths);
  both added to `ChangeHistoryClient` OBJECT_TYPES.
- Feature gate: `integration_middleware` (no new flag); the AI item additionally `ai_assistant`.

**Tests** (vitest, pure unless named): `schema/openapi.test.ts` (3.x and 2.0 fixtures, `$ref`
cycles, `allOf`, no matching operation, oversize), `schema/odata.test.ts` (enum, nav collection,
required), `schema/sample.test.ts`, `schema/discover.test.ts` (diff: new/missing, SSRF refusals
with a fake `fetchPublic`); `propose.test.ts` (normalisation, synonyms, type gate, each target used
once, enum → list proposal, Dataverse `msdyn_` prefixes); `convert.test.ts` (the vectors in
section 4, reverse where stated, refused on inbound where stated); `engine.test.ts` (compile
errors per row, run with problems collected, prebuilt body keeps the contract steps,
`value_unmapped` wording); `valueLists.test.ts` (one inbound row per code, CSV round trip with
`csvCell`, 409 on delete in use); `dispatch.test.ts` (no mapping row → unchanged body; mapping row
→ engine body; webhook mode mapping → sender body and `external_key` from `response_key_path`);
`mappingLogic.test.ts` (UI edits, dirty, stacking at 375 px via props); `tips.test.ts`;
`rlsPolicies.test.ts` (0203); `migration.test.ts` (0203 replay twice).

**SQL the owner runs**: `scripts/run-bundle-12-mapping-2026-10-21.sql` (0203 then
`scripts/seed-mapping-demo.sql`), on dev first, then production; listed in PROJECT.md as pending
on both DBs. 0203 runs with or without 0202 (the `webhooks` block is guarded by `to_regclass` and
`information_schema.columns`); if 0202 lands later, run 0203 again (idempotent).

## 9. Build plan: two work packages in parallel worktrees

**WP-A "Mapping backend"** (Sonnet): `supabase/migrations/0203_mapping_engine.sql`,
`scripts/seed-mapping-demo.sql`, `scripts/run-bundle-12-mapping-2026-10-21.sql`;
`src/lib/middleware/mapping/{types,convert,propose,engine,sourceRecord,valueLists,view}.ts` + tests;
`src/lib/middleware/schema/{types,openapi,odata,dataverse,sample,discover}.ts` + tests;
`src/lib/middleware/mapping/engineServer.ts`, `mappingStore.ts` (rows, versions, prune);
`src/lib/middleware/{dispatch,restart,monitorRows,metadata,metadataServer,mappingDoc,mappingOps}.ts`
(hook points, `summary.kind`, materialise-from-preset); `src/lib/webhooks/sender.ts` (+ `library.ts`
for `payload_mode: "mapping"`, `mapping_id`, `response_key_path`); `src/lib/connectors/d365/syncPull.ts`
(inbound rows); `src/app/api/middleware/mapping/{route.ts, reset/route.ts, restore/route.ts,
propose/route.ts, propose-ai/route.ts, schema/route.ts, try/route.ts}`,
`src/app/api/middleware/value-lists/{route.ts, [kind]/route.ts, [kind]/csv/route.ts, propose/route.ts}`;
`src/lib/ai/structured.ts` (surface "mapping"); `src/lib/rlsPolicies.test.ts`;
`ChangeHistoryClient.tsx` OBJECT_TYPES; `PROJECT.md` ledger. The existing `GET/PUT /api/middleware/mapping`
and `/reset` keep their contract for a document with no active row (the UI's `api.ts` is unchanged
for that case); the new fields below are additive.

**WP-B "Mapping UI"** (Sonnet): `src/app/(app)/settings/middleware/{MappingTab.tsx, MappingFields.tsx,
MappingValueLists.tsx, SchemaBar.tsx, ConverterSheet.tsx, ProposeMenu.tsx, AiReviewSheet.tsx,
TryItPanel.tsx, mappingLogic.ts, valueListLogic.ts, api.ts (new calls), tips.ts, tips.test.ts,
mappingLogic.test.ts, valueListLogic.test.ts, middleware.module.css}`; the webhooks panel's Request
tab (mode "mapping", generated template, Open mapping) when WP-B of the webhooks doc exists, else a
note in the commit. Until WP-A lands, WP-B runs on a fixture of the contract (`api.ts` `MOCK`
switch, removed before merge).

**Contract (WP-A builds, WP-B consumes; admin + flag or 404; pending schema → `{ needsDatabaseUpdate: true, bundle }`):**
- `GET /api/middleware/mapping?connection=<id>&document=<key>` → today's `MappingView` plus
  `{ engine: { active: boolean, version, versions:[{version, at, by}], usingStandard }, target: { kind, entity, linesPath, schema: { fetchedAt, sourceUrl, counts:{ total, new, missing } } }, sourceFields: { header:[{ key, label, type, custom }], lines:[...] }, targetFields: { header: TargetField[], lines: TargetField[] }, rows: { header: MapRow[], lines: MapRow[] }, missingRequired: string[], lists:[{ kind, label, rowCount }], ai: { available: boolean } }`.
- `PUT /api/middleware/mapping` `{ connection, document, rows: { header: MapRow[], lines: MapRow[] }, target?: { entity, linesPath } }` → the same view; 422 `{ errors:[{ rowId|field, message }] }`.
- `POST …/mapping/reset` `{ connection, document }`; `POST …/mapping/restore` `{ connection, document, version }`.
- `POST …/mapping/schema` `{ connection, document, source: "adapter"|"openapi"|"odata"|"sample"|"manual", url?, sample?, fields?, sendWebhookHeaders?, operation?: {method,path} }` → `{ target, targetFields, counts, operations?: [{method,path,summary}] }` (operations when none matched).
- `POST …/mapping/propose` `{ connection, document, mode: "fill"|"replace" }` → `{ rows, lists:[proposed ValueList] }` (not saved).
- `POST …/mapping/propose-ai` same input → `{ suggestions:[{ source, target, reason }], usage }`; 402-style `{ error, code:"over_budget" }` when the allowance is spent.
- `POST …/mapping/try` `{ connection, document, record_id? }` → `{ words, request:{ method, url, headers:string[], body }, problems:[{ code, message, fix, rowId? }] }`.
- `GET …/value-lists?connection=` → `{ lists:[{ kind, label, rows, default_in, counts:{ rows, unused, unmapped }, unmapped:{ out:string[], in:string[] } }], standardKinds:[{ kind, label, created }] }`.
- `PUT …/value-lists/<kind>?connection=` `{ label?, rows, default_in }` → the list; 422 per row (`{ errors:[{ row, message }] }`, e.g. two inbound rows for one code); `DELETE` → 409 `{ error, used_by:[{ document, field }] }` when referenced.
- `POST …/value-lists/propose?connection=` `{ kind? }` → proposed rows (not saved);
  `GET …/value-lists/<kind>/csv`, `POST …/value-lists/<kind>/csv` (multipart; `?confirm=1` applies, else returns the preview counts).
- Webhooks library (additive): `Webhook` gains `payload_mode: "mapping"`, `mapping_id`, `response_key_path`; `PATCH` accepts them (mapping_id tenant-verified, must be an active row for `connection = webhook:<id>`).

**Order**: 1 WP-A types + convert + propose + engine with tests (no routes yet) → 2 WP-A schema
parsers + discover → 3 WP-A store, routes, dispatch hook, sender hook, pull hook → WP-B in parallel
from step 1 on the fixture → 4 merge, `npx vitest run src/lib/middleware src/lib/webhooks
src/lib/rlsPolicies.test.ts`, `npx tsc --noEmit`, `npx next build` → 5 bundle 12 on dev, seed demo
→ 6 demo walk-through: open Mapping on Dynamics (standard view unchanged), edit one row (document
materialises, version 1), Propose, add a Unit list, map `uom` with it, Try it shows `M`, award a
quote with a line in "Box" → Monitor failed with the exact wording → add the row → Restart → OK;
create a Call webhook, fetch an OpenAPI schema from a request-bin's spec, Propose, Save, set the
webhook to mode mapping, award → body matches Try it; an unflagged tenant unchanged → 7 375 px
pass on both views and the sheets → 8 security pass (http URL, private host, redirect, key in
query, oversize spec, a converter payload with an unknown kind, a cross-tenant `mapping_id`).

**Acceptance**: no mapping row → identical bytes to today; Fields and Value mapping views on one
tab; a target schema from OpenAPI, OData and a pasted sample; a deterministic proposal with
confidence words; eight converters with their vectors; an unmapped value fails with the agreed
wording and restarts after the fix; a Call webhook sends the engine's body and stores the readable
id; nothing visible without the flag; `tsc`, `next build`, all tests clean; no push, Drive guides
only after the owner validates.

**Decisions still open for the owner (recommendation in brackets)**
1. **Unknown inbound code with no default**: keep the raw ERP code and count it (this spec), or
   skip the record and fail the run. [Keep and count: a pull must never stall on one code; the
   counter and the Monitor summary make it visible.]
2. **Ship the AI step in round 1** behind `ai_assistant`, or hold it until the deterministic
   proposal is validated on the demo tenant. [Hold: it is the last item of WP-A and the review
   sheet of WP-B; both are built behind the flag but the owner switches it on after step 6.]

## 10. Later (hook points stated, not built)
- **SOAP/WSDL**: a `schema/wsdl.ts` parser (XSD complex types → the same `TargetField` list) and a
  SOAP envelope writer in the webhook sender; the mapping document does not change.
- **Presets on this engine**: F&O, BC, SAP S/4 (`API_SALES_ORDER_SRV`, `API_ENTERPRISE_PROJECT_SRV`),
  ECC Gateway and ePROMIS ship as `MappingDocument` JSON files per adapter (`presets/*.json`),
  loaded by Reset to standard; the Dynamics `D365_OUTBOUND_PRESETS` move to the same form once the
  owner validates the engine on Dynamics (no behaviour change, tests prove it).
- **More documents**: Invoice, Purchase order, Sales order inbound: a source object + loader each
  (`sourceRecord.ts`), the Links row, no engine change.
- **Stage 2 of the readable id**: `response_key_path` on adapters too (one place for the key).
- **Journey "Call webhook" step** inherits mode mapping for free.
- **Lookup resolution**: a `lookup` converter (ERP entity + key field, resolved through
  `connector_links`) replaces today's fixed `account_external_id` bind for any lookup field.
