# Contract buy-out: sourcing the packages after the award (design, 2026-10-27)

Owner question: after KAMCO wins a project (for example from Aramco), does it make sense to subcontract and buy the lines through RFQs to several suppliers, compare the quotations, and carry the result until handover to ePROMIS or the ERP? Answer: yes. After the award the margin is decided in buy-out, so this is the next step of the tender flow. Mock-up (clickable, example figures): https://claude.ai/artifact/3QCMdk325dGj3CwjD7NFYA (source `buyout-mockup.html` in the 2026-10-27 session scratchpad).

## 0. Rule that governs everything

Only a contract project made from a tender (flags `gcc_tender` and `contract_projects`). The standard flow, the standard RFQ module and standard purchase orders do not change. Everything new is a new tab, new tables and a small, tender-only change to the RFQ page, as the Costing tab did.

## 1. What is already there (checked 2026-10-27)

| Piece | State today | Reuse |
|---|---|---|
| Project budget | `project_budget_lines` with resource type and cost code, revisions and baseline approval (0226); variations open revisions (0231) | Packages group budget lines |
| Bid cost | Per-line cost and markup snapshot of each bid version, locked table `tender_bid_version_costs` (0230) | "Cost in bid" per package, bid against committed |
| RFQ | `rfqs`, lines, supplier responses, compare, the award record `rfq_line_awards` (0224), lowest valid price, expired or stale flag | The whole compare-and-award logic |
| RFQ to order | Purchase orders from an RFQ (0130; needs the migration on the demo DB) | Purchase order per awarded package |
| Costing tab | New RFQ composer, compare screen, Award and price (tender-only) | Same panel patterns |
| Handover | Budget Excel; "Send to ePROMIS" exists and is greyed out | Send awarded packages the same way |
| Integration middleware | Entity rows, mapping, resync, ERP id line | Purchase order and subcontract order as entities |
| Suppliers | Type (vendor, subcontractor, both), status active; no qualification | Add supplier qualification |

Screens checked: contract project tabs, Costing, RFQ page, suppliers list, middleware page.

## 2. The twelve rules (bpmsquarecore 3c), one line each

1. **Simple:** one tab, one table of packages, a side panel; sensible defaults (one RFQ per package, three suppliers).
2. **Ease of use:** "Award package" in two taps; same words as Costing (Award, Lowest valid, Committed).
3. **Not crowded:** labels, numbers and actions; explanations behind the shared InfoTip.
4. **Collapsible:** panel sections collapse; table pages after a few rows; phone shows cards.
5. **Pricing choice:** internal pricing does not apply (these are costs). The package shows the quoted cost against budget only; no markup here.
6. **Documents:** the RFQ goes by email with the reply link (existing); purchase or subcontract order as PDF and email; linked both ways (package, RFQ, order).
7. **Document flow:** a package is born from budget lines of a project; the RFQ from the package; the order from the award. Source stored (`package_id` on the RFQ).
8. **AI by default:** assistant read access, global search by package, analytics tile (buy-out saving), briefing fact when a reply arrives; create-record card deferred (packages are made from budget lines in the UI).
9. **ERP:** purchase order and subcontract order entities in the middleware; Excel today, API when the ePROMIS documents arrive; ERP id line on the package.
10. **Change log:** create, award, un-award, send, qualification changes via `logChange`.
11. **Types per object:** package kind = Supplier or Subcontract (different required fields and vendor check); a workspace could add more later; no code branch per client.
12. **Show the data:** the Buy-out tab opens with four tiles (budget, committed, best quotes against budget, needs a decision); the mock-up is the starting visual.

## 3. Concept

- A **package** groups budget lines (for example pipes, precast, civil, road and testing). A budget line is in at most one package.
- One **RFQ per package**, sent to several suppliers or subcontractors, using the existing RFQ module; replies come by the reply link or email.
- **Compare and award** per package (default) or per line (existing). Reason required when not the lowest valid price (existing).
- **Committed** = the awarded total of the package. The tab shows **budget, bid cost, best quote and committed** and the saving or overrun, and warns (never blocks) when committed exceeds budget.
- **Handover:** the awarded package becomes a purchase order (supplier) or subcontract order (subcontract) and goes to ePROMIS or the ERP. Approval, goods receipt, payments and progress stay there.
- **Vendor check:** a supplier must be qualified for the package kind. Default: an unqualified supplier can be awarded only with an explicit override and a reason (the mock-up shows the strict version; to be confirmed with KAMCO).
- **Variations** that add scope can add budget lines to a new package.

## 4. Data (sketch, migrations to be numbered at build)

- `project_buyout_packages`: id, tenant_id, project_id, ref `PKG-####`, name, kind (supplier, subcontract), status (draft, out, ready, awarded, closed), rfq_id, awarded_supplier_id, committed_amount, currency, erp ids, note, created_by, timestamps.
- `project_buyout_package_lines`: package_id, budget_line_id (unique per project), tenant_id.
- `rfqs.package_id` and `rfqs.contract_project_id` (nullable, tender-only).
- `supplier_qualifications`: tenant_id, supplier_id, kind, status (approved, pending, expired), valid_until, note, approved_by.
- RLS: tenant SELECT only; writes by the service role. Cost never leaves the building: no v1, MCP or Data Workbench surface (internal-cost children, like variations).

## 5. Screens

- **Buy-out tab** on the contract project, after Budget: tiles, filters (All, Not sent, Out, Ready to award, Awarded), package table; row opens the side panel (bottom sheet under 780 px): lines, quotes side by side, budget bars, handover.
- **Budget tab:** a Committed column per budget line.
- **Overview:** one "Buy-out progress" card.
- **Phone:** cards, not a table; no sideways scroll (lesson from the billing schedule).

## 6. Integration points

Costing and the RFQ module (award, compare, replies), the project budget and revisions, the bid cost snapshot (bid cost against committed), variations (new packages), the Inbox (supplier replies by email), ePROMIS and the ERP (middleware entities), suppliers (qualification), analytics (buy-out saving), global search, change history, notifications to the project manager when a reply or an award is due.

## 7. Not in scope

Purchase order approval and receipt, payments, progress certificates, accounting, supplier onboarding portals.

## 8. Questions for KAMCO

1. Where are purchase orders and subcontracts raised after the award (ePROMIS, the ERP, or here)? This decides whether the handover is the end of our part.
2. Is there an approved vendor list, and who approves an award?
3. After winning, do they re-tender everything or keep the suppliers they priced with at bid time?

## 9. Build order

A. Schema, libs and rules (packages, lines, qualification, commitment maths). B. Buy-out tab and side panel. C. RFQ per package, award and committed, the tender-only change on the RFQ page. D. Vendor qualification and the override. E. Handover (Excel now; API when the ePROMIS documents arrive). F. Budget tab Committed column and the Overview card. G. Tests, capability facts, guide. Estimate: about two working days of builder time plus live verification. Depends on migration 0130 on the shared databases (purchase orders from an RFQ).

## 10. Decisions to confirm before the build

Vendor check strict or override (default override with a reason); award per package or per line (default per package, per line allowed); one RFQ per package (default) or several; whether the bid-time RFQ replies carry over as a starting point.
