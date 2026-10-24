# Document templates and assignments: one place for PDF design and selection — plan

> Owner ask, 2026-10-24: keep PDF creation (with AI) and the **rules that choose a template** (by coverage or other customer attributes)
> in one place, and let every object (quotes, orders, invoices and others) use it. Not built. Rule 6c: one place per setting.

## What is there today (looked first)

- **Quotations:** templates at Settings > Templates (redirect to the Quotations tab).
- **Standard Quotes:** `standard_quote_templates` (`0054`): ordered toggleable blocks, accent colour, logo position; chosen per quote, one default.
- **Sales Orders:** the order TYPE carries its own template JSON (blocks, accent, logo) and the type is chosen by rules (customer group, region,
  source type). That is a first version of the idea, kept inside the order object.
- **Invoices, purchase orders, RFQs, process studies:** fixed print layouts with the tenant letterhead; no choice.
- Selection by customer attribute exists only in the order type rules. Coverage (teams, segments, coverages) exists as its own model.

## The target: Settings > Document templates (one section, two tabs)

1. **Library.** One table of templates: name, which document types it can serve (quote, standard quote, order, invoice, PO, RFQ, ...), language
   and direction, accent, logo, status. A row opens the side panel (bottom sheet on phones): the block list (letterhead, document meta, parties,
   lines, totals, intro, notes, terms, signature, footer, plus per-type blocks), colours, fonts from a short safe list, a live preview with
   sample data, and **Create with AI**. Existing templates (Standard Quote templates, the order type designs, Quotation templates) are imported
   into the library unchanged; nothing a client uses changes.
2. **Assignments.** One table per document type, an ordered rule list: *when* (conditions) *use* (template). Conditions: coverage team or
   segment of the customer, customer country, account type or group, currency, language, custom fields of the account, order type, quote type,
   amount above a value, and "otherwise" (the default). First match wins; a person can still override on a single document ("Use another
   template"). The resolver is one function, `resolveTemplate(documentType, context)`, used by every PDF, print page, public link and email
   attachment. The rule editor shows "this would pick X" for a chosen sample customer so rules can be tested before saving.

## AI creation (safe by construction)

The AI never writes HTML. It returns a **block layout** in the same structured model the editor edits: which blocks, their order, accent colour
and logo side, labels translated (including Arabic), from one of: a plain description ("clean, blue, bilingual, terms on the last page"),
a pasted brand colour or logo, or an uploaded sample PDF or image of a layout the client likes. The result opens in the editor as a draft with
the preview; the person adjusts and saves. Metered like other AI calls; the uploaded sample is treated as untrusted data.

## Surfaces and phases

- **D1 Library and resolver.** Table `document_templates` (tenant, name, types, blocks jsonb, accent, logo position, language, direction),
  import of the existing templates, `resolveTemplate` with only the default rule, Standard Quotes and Sales Orders switched to it (order types
  point to a library template instead of holding their own JSON). Behaviour identical.
- **D2 Assignments.** Rules table and editor, the coverage and customer-attribute conditions, test-with-a-customer preview, per-document override.
- **D3 More documents.** Quotations, invoices, purchase orders, RFQs, work orders use the library; their fixed layouts become the default template.
- **D4 Create with AI.** From description, brand colours, uploaded sample.
- **D5 Arabic and right-to-left,** per template (needed for the Saudi invoice, `saudi-einvoicing-plan.md`; the invoice QR block lives here too).
- Every 3b and 3c surface that applies: change log, v1 read of template names and assignments (not blocks), assistant ("which template will this
  customer get?"), guide ids, one capability doc.

## Decisions for the owner

1. Is "first matching rule wins, with a manual override per document" the right behaviour?
2. Which customer attributes must be usable in rules first (coverage team, country, account group, language)?
3. Do clients need to design from scratch (full block editor) or mostly pick and tweak AI drafts?
