# SAP and ePROMIS connectors on the middleware frame

Proposal 2026-10-21 (owner: "we create 2 more connectors, SAP and ePROMIS", and
"in the middleware tab we have the same set of tabs for them as well"). Not
built. Depends on the middleware backend and page now being built
(`docs/design/integration-middleware.md`).

## 1. The frame: one adapter interface, Dynamics becomes adapter number one
The five tabs never talk to a vendor. They talk to an adapter:

```
ErpAdapter {
  id, label, authModes[], capabilities { pull[], pushQuote, pushProject, metadata, pickLists[] }
  testConnection(), metadata(entity), pickList(name)            // Connections, Mapping
  pull(entity, watermark), preview(entity)                      // Mapping, Resync
  pushAwarded(doc), pushRejected(doc)                           // What goes out
  readableKey(response), deepLink(record)                       // the readable id, no GUID
  presets { entityMaps, outboundMap }                           // works with zero mapping
}
```
The Dynamics code (`src/lib/connectors/d365/*`) is wrapped as the first adapter
with no behaviour change (its tests prove it). The registry
(`src/lib/connectors/registry.ts`) lists `sap` and `epromis` as new entries.
What an owner sees per connector is decided by `capabilities`: the rule label
("Quote" for Dynamics Sales, "Project" for ERPs), the pick-lists (Dynamics price
list, SAP project profile, none for ePROMIS) and the presets.

Awarded creates a **Project** in every ERP adapter (owner decision), a **Quote**
in Dynamics Sales; rejected sends nothing to an ERP project system and records
"Skipped: rejected, nothing to send" (a SAP quotation rejection is an option,
see decisions).

## 2. SAP: one connector, two adapters (owner 2026-10-21: S/4HANA and ECC; Business One is out)
Clients differ, so the connector asks "Which SAP?" (S/4HANA or ECC) and the
middleware tabs do not change.

**SAP S/4HANA (cloud or on-premise), OData.** Pull: `API_BUSINESS_PARTNER`
(customers, suppliers, contacts), `API_PRODUCT_SRV` (materials; price lists via
the pricing condition APIs later). Push on awarded: `API_ENTERPRISE_PROJECT_SRV`
creates an Enterprise Project (alternative, one setting: `API_SALES_ORDER_SRV`
sales order, or `API_SALES_QUOTATION_SRV` quotation). Auth: OAuth 2.0 client
credentials from a Communication Arrangement, or basic auth on-premise. Writes
need the CSRF round-trip (`x-csrf-token: Fetch` on a GET, then send it on the
POST); the client does this once per session. Readable key: the project ID or
document number in the response. Metadata: the service's `$metadata`.

**SAP ECC (6.0 and earlier), via SAP Gateway OData or SOAP.** ECC has no
standard `API_*` services. A client exposes what we need as Gateway OData
services (SEGW) or SOAP/REST wrappers over the standard BAPIs: customer master
(`BAPI_CUSTOMER_*`), material master (`BAPI_MATERIAL_*`), and for awarded a
project definition with WBS (`BAPI_PS_*` / `BAPI_BUS2001`, `BAPI_BUS2054`) or a
sales order (`BAPI_SALESORDER_CREATEFROMDAT2`). So the ECC adapter is the
configurable OData/REST engine of section 3 with an ECC preset: service paths
per entity are settings, the BAPI-to-field presets are shipped as templates the
client's SAP team implements once (a one-page "what to expose" sheet is part of
the guide). Auth: basic or an OAuth/SAML setup through Gateway or CPI; CSRF
fetch as in S/4. Readable key: project number or document number.

Both adapters: tenant-typed URLs only through `fetchPublic`, secrets sealed with
`sealSecret`, one running sync per entity (existing lock), links in
`connector_links` with `external_key` = the readable number.

## 3. ePROMIS: a configurable REST and file adapter
Public API documentation for ePROMIS was not found (a web search on
2026-10-21 returned review sites only; one directory says an API exists but
links no developer docs). So the ePROMIS connector is built so that **the
vendor's documentation becomes configuration, not code**:
- **REST lane:** base URL; auth (API key header, bearer token, basic, OAuth
  2.0 client credentials); per entity: endpoint, method, where the rows are in
  the JSON, paging style, modified-since parameter, id and key fields; for push:
  endpoint, method and a body template with the same `{placeholders}`.
- **Metadata:** from an uploaded OpenAPI/Swagger file, or inferred from a sample
  response ("Fetch sample"), so the Mapping tab still offers real field
  pick-lists.
- **File lane (works on day one):** the same entities as scheduled files in the
  Data Workbench formats (CSV/XLSX): export to a file, import from a file or
  SFTP drop, one schedule per entity, shown in the same Resync and Monitor tabs.
- Awarded = Project (one body template per tenant, preset provided).
When ePROMIS shares docs or a sandbox, a preset is added; nothing else changes.

## 4. How it looks on the page
Switcher chips at the top. For SAP the Connections tab asks: which SAP, system
URL, auth, client ID/secret or company DB, then Test connection. For ePROMIS:
base URL, auth, then "Add an entity" (or upload OpenAPI). The other four tabs
are identical in layout and wording for all three connectors. Easy-to-use rules
of the spec apply unchanged: set-up guide, presets, pick-lists, send a test
(prefix ZZ), plain-language failures.

## 5. Testing
- **SAP S/4:** the SAP Business Accelerator Hub sandbox
  (`https://sandbox.api.sap.com/s4hanacloud`, personal API key, sample data) is
  read-only, good for pull and metadata; push needs a real system (a client
  system, or an SAP trial). To confirm which APIs the sandbox offers.
- **SAP ECC:** needs a client or lab ECC system with the services exposed; until then tests use a fake Gateway server.
- **ePROMIS:** needs their documentation and a test tenant; until then unit
  tests run against a fake REST server and the file lane against sample files.

## 6. Build order (after the middleware backend and page are merged)
1. Extract the adapter interface, wrap Dynamics, no behaviour change (S).
2. Generic REST and file engine plus the ePROMIS adapter and preset shell (M).
3. SAP S/4 OData adapter (M).
4. SAP ECC adapter on the configurable OData engine, plus the "what to expose" sheet (M).
5. Each: registry entry, flag stays `integration_middleware`, monitor writes,
   tests with fake servers, guide after the owner validates.

## 7. Decisions for the owner
1. Which SAP do your clients run: S/4HANA (cloud or on-premise), Business One,
   ECC? One, two or all?
2. Do you have an SAP test system or trial, or do we start with the sandbox
   (read only)?
3. ePROMIS: can you get their API documentation or a test tenant? Until then
   the file lane plus configurable REST is what ships.
4. SAP awarded = Project, with Sales Order as an alternative setting: agreed?
   Rejected: nothing sent, or a rejected Sales Quotation?

## 8. Owner decisions (2026-10-21)
1. **SAP flavours:** S/4HANA and ECC. Business One is not in scope.
2. **SAP test system:** the owner will obtain an SAP trial. Until then S/4 is
   built against the read-only sandbox and a fake OData server; ECC against a
   fake Gateway server.
3. **ePROMIS:** the owner will have the API documentation. **No trial tenant**
   (ePROMIS does not offer one). Built from the documentation with a fake REST
   server and sample files; live verification happens at the first client
   environment. The file lane works without any of it.
4. **SAP follow-up (awarded as Project or Sales Order, what a rejected quote
   sends):** open, the owner decides later. Default until then: awarded =
   Project, rejected = nothing, both configurable.

## 9. Built: SAP S/4HANA pull (2026-10-22)
First SAP step, on the frame above, behind `integration_middleware`; nothing is sent to SAP yet.
- **What is already there (6c):** the connector chips, the connection panel, Links, Mapping, Resync (Scope, schedule,
  specific records), Monitor and Restart, `tenant_connectors`, `connector_links`, `connector_sync_runs`,
  `integration_messages`. SAP adds a chip (`sap_s4` in the registry, `middlewareOnly`: no tile without the flag) and no
  tab, no table, no migration.
- **Login (one choice on the panel):** Communication user (HTTP Basic: host, user, password) or an API key against the
  SAP Business Accelerator Hub sandbox (`sandbox.api.sap.com/s4hanacloud`, read only, sample data). Secrets are sealed in
  `tenant_connectors.credentials`, write only. Every call goes through `fetchPublic`.
- **Pull:** customers (`A_BusinessPartner` where `Customer ne ''`) to accounts, suppliers (`Supplier ne ''`) to
  suppliers, products (`API_PRODUCT_SRV/A_Product` with the English description) to products. The key is the readable
  SAP number, the pull is incremental by `LastChangeDate` (position `d|day`, or `k|...` while a capped scan continues),
  a content hash says "unchanged", the run row is the lock, and each run writes one Monitor message
  (`connector_id = sap_s4`). Contacts are later.
- **Scope:** structured attributes of the main entity set only (sales area and country are not offered); the panel says so.
- **Frame:** `src/lib/connectors/adapter.ts` (`ErpAdapter`), implemented by `sapAdapter()`; Dynamics is not rewritten.
- **Needs in SAP:** Communication Arrangements for SAP_COM_0008 (Business Partner, Customer and Supplier Integration)
  and SAP_COM_0009 (Product Integration). `scripts/sap-s4-smoke.mjs` checks a real system from the environment.
