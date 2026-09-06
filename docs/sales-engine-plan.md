# BPMSquare Sales Engine — plan v1.0 (2026-09-06)

> Owner's questions after the cost-based walkthrough, answered as one plan:
> freight, price-all, quantity breaks and alternatives, multi-supplier,
> approvals, versioning, a rules layer, "win the quote", and the Pipeline
> object as the predecessor of the quote. Pricing spec:
> `docs/pricing-engine-architecture.md` (§17 batches stand; this plan
> sequences around them). Nothing here is built yet unless marked.

---

## 0. The shape in one paragraph

A **Lead** becomes an **Opportunity** (the Pipeline object; it does not exist
today, `/pipeline` is a placeholder). An opportunity holds the customer, the
lines being pursued and their engine prices, the people working it, the
win rating and the deal room. Every **Quote** (Quotation or Standard Quote)
belongs to an opportunity; a quote is one *version of the offer*, the
opportunity is the *deal*. Pricing, approvals, the rules layer and the
"win" intelligence hang off the deal so they are built once and seen on
both the opportunity and its quotes. Won opportunity → work order /
invoice, which already exist.

```
Lead ──▶ Opportunity ──▶ Quote v1 ──▶ Quote v2 … ──▶ Won ──▶ Work order ▶ Invoice
            │ lines + engine price       ▲ same lines, same engine
            │ win rating, deal room      │ versions under the deal
            │ approvals, rules           │
            └── Pipeline board (by stage)
```

## 1. Opportunity — the Pipeline object

**Table `opportunities`** (tenant_id, RLS, custom_data, ref OPP-0001 via
`insertWithMasterRef`; the §3b checklist applies in full):

| Field | Note |
|---|---|
| account_id, contact_id | tenant-verified foreign ids |
| title, description | |
| stage | tenant-configurable like `quote_statuses` (`config.opportunity_stages`); defaults Qualify → Propose → Negotiate → Won / Lost |
| outcome, loss_reason, loss_note | reuse `QUOTE_OUTCOMES` / `LOSS_REASONS` so loss intelligence aggregates across deals and quotes |
| expected_close, amount, currency | amount = latest quote total, else sum of opportunity lines |
| probability | rubric-derived (§7), overridable with a reason |
| owner_id, team (jsonb) | owner + "who knows the customer" (§7) |
| source, lead_id, source_campaign_id | Lead → Opportunity carries the source |
| competitor | free text now, vocabulary later |

**Table `opportunity_lines`**: the **shared document-line contract** (below).

**Pricing on the opportunity**: the same `priceDocumentLine()` with
`document_type: "opportunity"`, so a tenant can route opportunities to a
budgetary price book and quotes to the firm one, or use one book for both.
Lines keep `pricing_document_id` + server-derived `pricing_flags`. "Price
all lines" (§2) works here first.

**Convert to quote**: one action creates a Quotation or Standard Quote
under the opportunity with the lines copied *and re-priced on the quote's
date* (the opportunity's pricing documents stay as the budget trail). The
quote gets `opportunity_id`; both quote objects gain that column.

**Pipeline page** becomes the board: opportunities by stage, amount and
probability per column, drag to move stage (stage change is an event the
rules layer can act on). Filters by owner, account, close month.

**Lead**: keep; a lead converts to an opportunity (status `quoted` on the
lead is replaced by "converted", the opportunity carries on).

## 2. The document line, once

One line shape for opportunity lines, standard quote lines, quote lines and
(later) work-order lines, so pricing, breaks and alternatives are built
once:

```
product_id, description, uom, qty, rate, discount_pct, amount,
pricing_document_id, pricing_flags,
group_id, group_label, group_type ('additive' | 'alternative'),
break_of (line id) + break_qty          -- quantity breaks, §3
sl_no, custom_data
```

Quotations already have `group_*` with alternative option groups and
`selected_option_id`; Standard Quotes have none of it. The contract lifts
Quotations' model to the other two objects.

**Price all lines** (form change, not engine): one call prices every
product line, fills every rate, lists the NEEDS_RFQ lines with a Send RFQ
per line, and re-prices automatically when a priced line's product or
quantity changes. The engine already prices multi-line documents.

**Line rate and tax** — owner decision pending: the line takes **NET_2**
(pre-tax) and the header applies tax (recommended), or the procedure keeps
TAX and the forms hide header tax for engine-priced quotes.

## 3. Quantity breaks and alternatives

- **Alternatives**: the Quotations option-group model (group_type
  `alternative`, one selected option counts in the total) becomes the
  shared model. Standard Quotes and opportunities get it.
- **Quantity breaks**: two halves.
  1. *Engine*: the cost-based setup exposes volume tiers on Margin and
     Customer discount (`ScaleTable` already exists in the core; the
     price-list template uses it for list price).
  2. *Document*: a line can carry break rows (`break_of`, `break_qty`):
     "1–9 at A, 10–49 at B, 50+ at C", each priced by the engine at that
     quantity, printed as a break table, and only the chosen quantity
     counts in the total. On acceptance the customer's chosen break becomes
     the line.

## 4. Freight and additional costs

Today: Freight and Handling are percent-of-TOTAL_COST rules by region,
inbound by intent, no leg, no rate card; outbound delivery is the quote
header's shipping amount, outside the engine.

**Freight model** (`config.pricing.freight` + a `freight_rates` table):

| Leg | Where in the waterfall | Basis options |
|---|---|---|
| Inbound (supplier → warehouse) | before LANDED_COST, part of cost | % of cost, per unit, per kg, per shipment, lane rate card (origin → destination zone) |
| Outbound (warehouse → customer) | after margin, its own component, printed as a line or absorbed | same bases + Incoterm: EXW / FOB (customer pays) vs DAP / DDP (we charge or absorb) |
| Direct (supplier → customer) | inbound leg = 0, outbound = supplier's delivery quote (RFQ carries it) | |

Product gains `weight_kg` / `volume_m3` for per-kg bases; the account gains
`incoterm` default; the RFQ form gains "includes delivery to …". Additional
costs (packing, insurance, duties, certification) are the same mechanism:
a `SURCHARGE` component with a basis and a rate card, inbound or outbound.

## 5. Multi-supplier

**Table `product_suppliers`** (product_id, supplier_id, preferred, cost,
currency, uom, lead_time_days, moq, valid_from/to, as_of, notes; tenant
RLS). The ladder gets a per-supplier rung: the winning cost is the
preferred supplier's figure in force, else the lowest in force, with the
supplier named in the trace ("92,500 from Meridian, preferred; Anand 89,000
not preferred"). RFQ from a line goes to **all approved suppliers** for the
product in one action; each reply lands on its own `product_suppliers`
row and as its own cost input. Supplier master data as it stands is enough;
the link table is what is missing.

## 6. Platform services: rules layer and approval engine

Built once, used by opportunities, quotes, pricing config, WFM.

**Rules layer** (`automation_rules`): `when <object> <event> [and
<conditions>] then <actions>`. Events: created, field changed, stage /
status changed, priced, sent, customer opened / accepted / asked for change,
approval decided. Conditions: the pricing DSL (already exists) over the
object's fields. Actions, a fixed safe list: set field, change stage /
status, start approval, notify (user / role / email), create task, add
comment, create revision. Settings screen, tenant-scoped, every firing
logged. Not BPMN; no loops, no scripting.

**Approval engine** (`approval_policies`, `approvals`, `approval_steps`):
policies are rules of the form "for <object> when <condition> require
<steps>", steps ordered, each step a role or a named user or "manager of
requester", with delegation and a due time. The object shows an
**Approvals tab**: the chain, who is next, who decided what and when. An
approver inbox (Nova inbox already routes mentions; approvals ride the same
rail). Blocked quotes today have no way out except re-pricing — this is
the way out. Pricing spec batch 3's `pricing_approvals` is folded into
this rather than built on its own.

## 7. Versioning

- Quotations: Revise exists (revision +1, `superseded_by`, `quote_revisions`),
  manual, and a sent quotation can still be edited.
- Standard Quotes: nothing.

**Rule**: once a quote is Sent, Edit becomes Revise on both objects. A
revision copies lines *with* their pricing documents, then re-prices on
save (the old version stays explainable). The public quote page gains
**Accept** and **Ask for a change** (the request text lands on the deal
room and, through the rules layer, opens a revision and notifies the
owner). Opportunity amount follows the latest version.

## 8. Win the deal — the tab on the opportunity, mirrored on the quote

In the order they earn their place (all on data already in the system
unless marked AI):

1. **Win rating**, a rubric that returns its working (same doctrine as the
   Account 360 rating; AI may rewrite the sentence, never the number):
   past quotes with this account (won / lost / dropped, decision time),
   price vs the account's usual band, margin vs floor, discount vs last
   time, link opened, days since activity, open service cases.
2. **Price position** per line: what this customer paid last time, the
   band other customers in the same tier / region paid in 12 months (from
   stored pricing documents), where this line sits.
3. **Who knows the customer**: who won their last quotes, who closes their
   cases, account owner, last email — one click to mention them (Nova
   comments + inbox exist).
4. **Customer signals** from the public link: opened, re-opened after a
   price change, accepted, asked for a change.
5. **What they usually buy / what is missing**: co-bought products, the
   AMC or accessory normally on a quote like this, assets due for
   replacement.
6. **Follow-up nudges**: "sent 7 days ago, not opened, this customer
   decides in 10" as a task (rules layer).
7. **Deal room**: internal thread (Nova timeline) + checklist driven by
   rules (approval, technical sign-off, sample, site visit).
8. **Market brief (AI)**: the account's industry and recent news, what to
   lead with; sourced, dated, marked as AI, never a price input.
9. **Objection playbook (AI over tenant-authored answers)**.

## 9. Sequence — one piece at a time, each validated on the demo

| # | Piece | Size | Why here |
|---|---|---|---|
| A | Quote line essentials: Price all lines, auto re-price, NET_2 decision, alternatives + breaks on the shared line contract (Standard Quotes first) | S–M | Unblocks the demo story; the contract is needed by B |
| B | Opportunity object + lines + pricing + convert to quote + Pipeline board + Lead conversion | L | The deal is the anchor for everything below |
| C | Rules layer + approval engine (platform), Approvals tab on quote and opportunity; folds pricing batch 3 | L | Blocked quotes need a way out; rules drive versioning and nudges |
| D | Versioning rule on both quote objects + Accept / Ask for a change on the public link | S | Small once C exists |
| E | Win tab, items 1–4 | M | Pure data; first visible "intelligence" |
| F | Freight model (legs, bases, rate card, Incoterms) | M | Needed before a real manufacturer demo |
| G | Multi-supplier (product_suppliers, ladder rung, multi-RFQ) | M | Same |
| H | Win tab items 5–9 | M | Needs C for nudges and checklist |
| I | Price-list, value-based, variant techniques on the same rails; pricing batches 4–8 | per spec | After the sales objects exist |

Order of A → B → C is the important part: the line contract before the
deal, the deal before the engines that act on it. E can run in parallel
with C if hands allow.

## 10. Decisions needed from the owner

1. Line rate NET_2 (pre-tax) with header tax — yes / no.
2. Opportunity stages default set, and whether a lead is mandatory before
   an opportunity (recommendation: no, an opportunity can start directly).
3. Does a Standard Quote always belong to an opportunity (recommendation:
   yes, auto-created if the rep starts from the quote).
4. Approval policy examples for the demo (e.g. margin < floor → pricing
   manager; total > 10 lakh → sales head; both → both, in that order).
5. Freight: which legs and bases the first real tenant needs.
