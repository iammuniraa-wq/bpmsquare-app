# Saudi e-invoicing (ZATCA, Fatoora Phase 2) — plan

> Plan for the owner, 2026-10-24. Not built. Scope: **Saudi Arabia only** (owner, 2026-10-23); UAE (Peppol) later through the same
> connector interface. Everything marked *verify* must be checked against the current ZATCA specification and the chosen provider's
> documentation before building. Region packs are the switch (`docs/design/gcc-sales-estimating-plan.md` section 0).

## 1. What the regulation asks of an invoice (to verify)

- **Two flows.** *Standard tax invoice* (B2B, buyer has a VAT number): sent to ZATCA first for **clearance**; valid only once cleared.
  *Simplified tax invoice* (B2C): issued at once, **reported** within 24 hours. Credit and debit notes follow the same two paths.
  A cleared or reported invoice is never edited or deleted: corrections go by credit or debit note.
- **Machine data on every invoice:** UBL 2.1 XML (ZATCA profile), a document UUID, a running invoice counter (ICV), the hash of the
  previous invoice (PIH, a hash chain per device/unit), a cryptographic stamp, and a QR code (signed TLV data).
- **Mandatory content:** seller VAT number, CRN and structured address (building number, street, district, city, postal code); buyer
  VAT and address for standard invoices; per-line VAT category and rate; totals by rate; issue date and time; **Arabic** text on the
  printed document (bilingual accepted).
- **Onboarding per seller unit:** compliance CSID then production CSID from the seller's Fatoora account using a one-time code, per
  e-invoice generation solution unit (EGS).
- **Retention:** invoices and their XML must be kept (verify the period; plan for at least 6 years) and be retrievable.

## 2. What exists today

No tax or e-invoice fields on invoices or lines (`invoices` has total/discount only, one `config.tax` rate, `entities[].gstin`); no
buyer tax id or Arabic names; no QR; no provider concept; invoices exist from quotes, work orders and WFM project hours. The Integration
middleware (Links, Mapping, Monitor, Resync, webhooks library, `integration_messages`) is the right home for the submission flow.

## 3. The one real choice: who signs

| | A. Certified solution provider's API | B. Our own connector to ZATCA's APIs |
|---|---|---|
| We send | invoice data (JSON) | we build XML, hash chain, signature, QR ourselves |
| We get back | status, QR, signed XML | ZATCA's clearance or report response |
| Effort | smaller; their certification | large: certificates, key storage, counter, validation, certification risk |
| Cost | per invoice or subscription | none per invoice |
| Risk | provider dependency | we own compliance changes |

**Recommendation: A first, behind a connector interface so B can replace it.** The interface is four calls: `prepare(invoice)`,
`submit(invoice)` returning clearance or reporting result, `status(ref)`, `credit(invoice, reason)`; a mock provider ships for tests and
demos. Confirm per client whether the **ERP already issues the legal invoice** (then BPMSquare only mirrors status: variant E5).

## 4. Phases

- **E1 Data readiness (no submission).** Per-line tax code and rate and totals by rate on invoices and lines (nullable, additive; Vikas
  and India GST screens unchanged); seller and buyer tax ids, CRN and structured address (entities and accounts; Arabic name fields);
  document type (standard, simplified, credit note, debit note) and a credit-note flow linking to the original; per-unit sequential
  numbering; a bilingual (Arabic and English) invoice template with a QR placeholder; validation that blocks "not ready" invoices with
  a clear list of what is missing. All gated by the Saudi region pack (`e_invoicing = ksa_zatca`).
- **E2 Connector framework.** `e-invoicing` connector kind in the middleware registry, the interface above, the mock provider,
  `einvoice_documents` (invoice, uuid, icv, pih, type, status prepared | submitted | cleared | reported | rejected | failed, provider
  ref, QR, xml path, error list, attempts) with service-role-only writes and member read; messages in Monitor with Retry, like quotes.
- **E3 Real provider and onboarding.** Chosen provider connected against ZATCA's sandbox (simulation) first; an onboarding wizard in
  the connector chip (enter the one-time code, obtain CSIDs through the provider, test invoice) with certificates and keys sealed
  (`sealSecret`) in a service-role table, never in `tenants.config`; one unit per entity; status chip on the invoice (Not required |
  Prepared | Cleared | Reported | Rejected), the QR printed, the invoice locked once cleared or reported.
- **E4 Reporting and operations.** B2C reporting queue with a 24-hour guard (cron, alert before the deadline), rejected-invoice
  handling with the provider's error list in plain words, dead-letter queue, daily reconciliation job against the provider, archive
  export (XML + PDF, per period), audit trail, alerts to the finance owner.
- **E5 ERP-issued variant.** Read invoice status, UUID and QR from the ERP (D365 and SAP document flow, shared with Sales Order SO2)
  and show the chip only; no signing here.

## 5. Surfaces (rule 3c)

List and detail chips and filters; invoice PDF and email carry the QR; v1 API exposes status and uuid (not keys); change history;
webhook events `invoice.cleared / rejected`; assistant and briefing ("2 invoices rejected by ZATCA"); Data Workbench export of the
status columns; guide ids; documentation (Admin & Setup guide section for onboarding).

## 6. Testing and safety

ZATCA sandbox and the official validator; golden test vectors for the XML and hash chain (provider A may hide this, keep it for B);
property tests for totals and rounding (halalas, per-line versus per-invoice VAT); idempotent submission (never double-submit a
number); a hard rule that a cleared invoice cannot be edited or deleted by any route (including Data Workbench update and v1);
secrets and certificates are never logged. Everything additive and behind the pack and a platform-admin flag.

## 7. Dependencies and open decisions

- Region pack framework (Country in scoping) and the entity (seller unit) model.
- **Decisions for the owner:** (1) provider (A) versus own connector (B); (2) which providers to evaluate (ZATCA lists certified
  solution providers; get two quotes); (3) per client, issued from BPMSquare or from the ERP; (4) one unit per legal entity or per
  branch; (5) Arabic names for customers captured at account creation or only on invoices.
- Risks: regulatory changes (version the XML builder and rules), provider outage (queue and retry), clock and sequence integrity,
  cut-over date for each client's wave.

## 8. E1 as built (2026-10-25)

Built behind the platform-admin flag `einvoicing_ksa` (with `config.einvoicing.scheme`; absent with the flag on = `ksa_zatca`, `null` = off). Data: migration `0219` / bundle 30
(buyer fields on `accounts`, document fields on `invoices`, VAT fields on `invoice_lines`, the counter table and `allocate_einvoice_seq()`, a guard trigger). The seller unit is an
entity in `tenants.config.entities` (no column). Code: `src/lib/einvoicing/` (rules in `rules.ts` only, halala maths in `totals.ts`, readiness in `validate.ts`, counter wrapper in
`counter.ts`, labels in `labels.ts`, DB side in `server.ts`).

- **Readiness** lists what is missing in plain words with a link to where it is fixed (seller: Company > Entities; buyer: the account; lines and invoice: the invoice's "Saudi e-invoice" section).
- **Sending a draft** (status to sent, or the email) is the issue step: it requires Ready, then stamps UUID, type, issue time, supply date and takes the counter number. No number is taken at creation, and an invoice that holds one cannot be deleted.
- **Rounding:** VAT is rounded once per VAT group (category + rate) on the taxable amount after the document discount, which is split across the groups by largest remainder. Per-line VAT is indicative only and is not printed.
- **Credit note:** a new draft invoice typed `credit_note`, positive amounts, linked by `original_invoice_id`, with a reason; ledger views count it with `ledgerSign()`.
- **Not done:** any call to ZATCA, XML, hash chain, QR (a marked placeholder prints), the connector, `einvoice_documents`, onboarding, locking a cleared invoice, Data Workbench import/update of these fields, foreign-currency invoices.
- **Assumed, to verify against the current ZATCA specification before E2:** VAT number 15 digits starting and ending with 3; CRN 10 digits; postal code 5 digits; building number 4 digits; standard-invoice buyer needs VAT number, name, Arabic name and full address; supply date required on a standard invoice; Z/E/O lines are 0% with a stated reason; a Standard line is above 0%; notes need the original and a reason; per-group VAT rounding.
