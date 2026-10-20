# ERP integration plan: master and transaction data, both ways

Snapshot 2026-10-21 (Fable design; owner to approve the phases and the open
decisions before any build beyond phase 0). The message to clients stays
the one the owner set on 2026-10-20: **BPMSquare integrates with your ERP,
any ERP.** This plan says how, in what order, and what already works.

## 1. Principles

1. **One system of record per object.** Masters (customers, suppliers,
   materials, price lists, BOMs, employees, projects) belong to the ERP and
   are *replicated* into BPMSquare. Transactions that start with a
   salesperson (opportunity, quote, standard quote, estimate, RFQ) belong to
   BPMSquare until they are won; the won document creates the order or
   project in the ERP, and from then on the ERP owns it. Invoices, stock and
   actual costs come back from the ERP.
2. **Replicate, never re-key.** A replicated field is only ever written by
   the sync for records the sync created or claimed; a blank in the ERP never
   wipes a value here; nothing is deleted by a sync (same rules the D365
   connector already follows).
3. **Three lanes, one shape.** Files (Data Workbench), the REST API with its
   change feed and webhooks, and connectors. All three move the same objects
   with the same field names, so a client can start with files on day one
   and move to a connector later without changing anything else.
4. **Every record keeps its ERP identity.** `external_refs` (phase 1): which
   system, which id, for every replicated or pushed record, unique per
   tenant and system. Matching is by that id, never by name.
5. **Tenant isolation and safety as today.** Every read and write is tenant
   scoped; tenant-typed URLs go through `assertSafeSourceUrl` / `safeHost`;
   payloads are HMAC-signed; secrets are encrypted and write-only; settings
   are admin-only; API keys are scoped per object.

## 2. Objects, direction and today's state

| Object | Record of | ERP → BPMSquare | BPMSquare → ERP | Works today |
|---|---|---|---|---|
| Customers (accounts) | ERP | replicate | push a new prospect once won (optional) | DW import/update; API read; D365 pull; on-demand "Push to ERP" |
| Contacts | shared | replicate | push new contacts (optional) | DW; API read; D365 pull (Dataverse) |
| Suppliers | ERP | replicate | — | DW; API read; D365 pull |
| Materials / products (cost, list price, **quantity breaks**, item type, tax) | ERP | replicate | — | DW; API read; D365 pull; quantity breaks on every surface (2026-10-21 build) |
| Bills of materials | ERP | replicate | export (file) | DW for BOM lines; estimator BOM export file |
| Price lists with scales | ERP | replicate as product bands | — | product `qty_breaks` via DW and API; customer-specific lists as price-book rules (wizard) |
| Costs (moving average, last purchase) | ERP | replicate `cost_price` + `as_of` | — | DW; D365 pull; the pricing ladder treats old figures as stale |
| Employees, sites, projects | ERP / HR | replicate | hours and costs out | DW; D365 projects pull; WFM hours export (CA Excel) |
| Opportunities, quotes, standard quotes, estimates | BPMSquare | status back (won/lost in ERP, order number) | **won → sales order / project** | change feed + webhooks for every change; D365 push of a won fence project |
| RFQs and supplier replies | BPMSquare | — | awarded RFQ → purchase requisition (optional) | RFQ reply becomes a confirmed cost |
| Purchase orders | ERP | replicate status | create from awarded RFQ (optional) | DW; API read |
| Invoices | ERP (or BPMSquare for small tenants) | replicate status and payments | create from won quote / work order | DW; API read; in-app invoices |
| Work orders / service orders | BPMSquare | — | push for billing | DW; API read |
| WFM attendance and overtime | BPMSquare | — | payroll / project costing file | monthly summary export |

"DW" = Data Workbench import, export and update, keyed on the real record id
(§3 of the project rules). "API read" = `GET /api/v1/<object>` with filters
and enrichment. The change feed is `GET /api/v1/changes?since=` (every
create, update and delete in order); webhooks are the same feed pushed to a
signed URL with auto-pause on failure.

## 3. Phases

**Phase 0, now, no code: what a client can do today.**
Load masters with Data Workbench files (export from the ERP, map once, import;
later changes through Update with the exported ids). Read everything through
the REST API; subscribe a webhook to the change feed for quotes and
standard quotes to learn when one is won. Dynamics 365 clients connect the
connector and pull customers, contacts, vendors, products and projects on a
schedule. This is the PCBS/KOMCO story for the first conversation.

**Phase 1, identity and idempotency (S).**
- `external_refs` table: tenant, object type, object id, system (`epromis`,
  `d365`, `sap`, a free label for files), external id, last synced at;
  unique on (tenant, system, external id). RLS select-only; writes on the
  service client. `connector_links` becomes a view of it (or is migrated).
- Data Workbench Update and every v1 write accept `external_id` +
  `external_system` and upsert by them when present; the id column stays the
  contract when the caller has it.
- Every record page shows its ERP reference as a fact line (no paragraph).

**Phase 2, the ERP writes to us (M).**
`POST`/`PATCH /api/v1/{accounts,contacts,suppliers,products}` and
`/products/{id}/bom-lines`, same validation as the app routes, feature-gated,
`EXPLICIT_SCOPE_ONLY` for contacts (PII). Products carry `qty_breaks`,
`cost_price`, `cost_price_as_of`, `item_type`. This is how an ERP with an
outbound integration layer (ePROMIS, SAP PI/CPI, Business Central) keeps
masters current without files.

**Phase 3, won documents go out as one standard payload (M).**
- One `DocumentWon` payload for opportunity, quote and standard quote:
  header (customer with its external ref, currency, dates, totals), lines
  (product external ref, quantity, unit, price, discount, tax, the price
  book and band that applied), attachments as links.
- Delivered three ways from one event (`document.won`): the change feed,
  webhooks (`object_types`), and "Push to ERP" on the document (today only
  accounts have the button). Coverage keeps routing a document to the right
  ERP endpoint (`erp_endpoint_id`).
- The ERP answers with its order or project number; the receiver route
  stores it in `external_refs` and the document shows "In ERP as SO-1042".
- Invoices and work orders follow the same shape in the same phase.

**Phase 4, connectors as adapters on one frame (L).**
Generalise the D365 connector's frame (`pull(entity, watermark)`,
`push(document)`, preview, map, runs ledger, one run at a time, cron) into
`src/lib/connectors/erp/` with the Dynamics code as the first adapter.
Add adapters when a client brings API documentation: ePROMIS (no public API
documentation known; files and phase 2 are the day-one path), SAP (OData
on S/4 or Business One Service Layer), Odoo (JSON-RPC). Each adapter is one
file family; the settings screen, the map editor and the runs page are
shared.

**Phase 5, keep it honest (S).**
A "Sync health" settings page: last run per entity, rows failed with the
ERP's own message, records with no external ref, differences found by a
weekly reconciliation of counts and totals. Retention on run logs.

## 4. Integration points inside the suite

- Pricing: replicated `cost_price` with `as_of` feeds the cost ladder;
  product bands feed the price-list technique (`pricing-engine-architecture.md`
  §21); an awarded RFQ can become a purchase requisition in phase 3.
- Estimator: BOM export already exists; the won estimate's quote goes out
  through the phase 3 payload.
- Coverage: owner and ERP endpoint per account are decided here, so a
  multi-company client routes each document to the right company.
- Marketing: nothing goes to the ERP; won revenue returned by the ERP (phase
  3) improves attribution.
- WFM: hours and overtime out as a payroll file (today); a push lane later.

## 5. Open decisions for the owner

1. First ERP adapter after Dynamics: ePROMIS (needs their API documentation
   or a file schedule) or SAP.
2. System of record for invoices per tenant: a tenant setting, default ERP
   when a connector is on, else BPMSquare.
3. When a quote goes out: at "won" only (this plan) or also at "sent" as a
   quotation document in the ERP.
4. Whether `connector_links` is migrated into `external_refs` in phase 1 or
   kept and mirrored.

## 6. Sizes

Phase 1 S (2 days), phase 2 M (4 days), phase 3 M (5 days), phase 4 L (a
week per adapter after the frame), phase 5 S. Phases 1 to 3 are independent
of any ERP and should be built first; they also make the client demo true
for every ERP, not only Dynamics.
