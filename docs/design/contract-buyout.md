# Contract buy-out: sourcing the packages after the award (design, 2026-10-27, decisions 2026-10-28)

Owner question: after KAMCO wins a project (for example from Aramco), buy and subcontract the lines through RFQs to several suppliers, compare the quotations, and carry the result until handover to ePROMIS or the ERP. Mock-up (clickable, example figures): https://claude.ai/artifact/3QCMdk325dGj3CwjD7NFYA

## 0. Rule that governs everything

Only a contract project made from a tender (flags `gcc_tender` and `contract_projects`). The standard flow, the standard RFQ module and standard purchase orders do not change. Everything new is a tab, new tables, and small tender-only changes to the RFQ supplier picker, as the Costing tab did.

## 0b. Owner decisions (2026-10-28), do not reopen

1. **No purchase orders in our system.** Purchase orders and subcontract orders are raised in ePROMIS or the ERP. We stop at the award and the handover (Excel now, API when the ePROMIS documents arrive). No dependency on migration 0130.
2. **Approved vendor lists are supplier groups, per client.** A group (for example "Aramco approved vendors") is linked to a client account. When a deal or project belongs to that account, the supplier picker offers only the group's members. Strict, no override. No group for the account means all suppliers (with a quiet note "No approved list for this client").
3. **Award per package.** One supplier takes the whole package.
4. **Several RFQs per package, for audit.** Each round (first request, re-quote, final) is its own RFQ and all of them are kept with their replies. One round is the current one; the award names the round and the supplier and records who and why.
5. Re-tender versus keep the bid-time suppliers: parked (not known yet).

## 1. What is already there (checked 2026-10-27)

| Piece | State today | Reuse |
|---|---|---|
| Project budget | `project_budget_lines` with resource type and cost code, revisions and baseline approval (0226); variations open revisions (0231) | Packages group budget lines |
| Bid cost | Per-line cost and markup snapshot of each bid version, locked table `tender_bid_version_costs` (0230) | "Cost in bid" per package |
| RFQ | `rfqs`, lines, supplier responses, compare, award record `rfq_line_awards` (0224), lowest valid price, expired or stale flag | Compare-and-award logic |
| Costing tab | New RFQ composer, compare screen, Award and price (tender-only) | Same panel patterns; same supplier picker |
| Handover | Budget Excel; "Send to ePROMIS" greyed out | Package handover Excel |
| Integration middleware | Entity rows, mapping, resync, ERP id line | Package order entity later |
| Suppliers | Type (vendor, subcontractor, both), status active; no groups | Add supplier groups |

## 2. The twelve rules (bpmsquarecore 3c), one line each

1. **Simple:** one tab, one table of packages, a side panel; defaults decide the rest.
2. **Ease of use:** "Award package" in two taps; same words as Costing.
3. **Not crowded:** labels, numbers, actions; explanations behind the InfoTip.
4. **Collapsible:** panel sections collapse; table pages; phone shows cards.
5. **Pricing choice:** not applicable (these are costs); quoted cost against budget only, no markup.
6. **Documents:** RFQ by email with the reply link (existing); the handover is an Excel per awarded package; linked both ways (package, RFQ rounds, handover).
7. **Document flow:** package from budget lines; RFQ round from the package (`package_id`); handover from the award.
8. **AI by default:** assistant read access, global search by package, analytics tile (buy-out saving), briefing fact on a reply; create-record card deferred (packages are made from budget lines in the UI).
9. **ERP:** package order entity in the middleware later; Excel now; ERP id line on the package.
10. **Change log:** create, send round, award, un-award, handover, group membership via `logChange`.
11. **Types per object:** package kind Supplier or Subcontract (different required fields), data not code.
12. **Show the data:** four tiles, the package table, side panel with quotes side by side (see the mock-up).

## 3. Concept

- A **package** groups budget lines. A budget line is in at most one package.
- **RFQ rounds:** "Send request" creates a new RFQ for the package to chosen suppliers (picker limited to the client's approved group). A new round never deletes the earlier ones; the panel lists the rounds newest first with who replied and the lowest valid price in each.
- **Award per package:** choose one supplier from one round; reason required when it is not the lowest valid price in the current round (existing rule). Writes the award to every line of the package (`rfq_line_awards`) and sets the package's awarded round, supplier, committed amount, who and when. **Un-award** (with a reason) is allowed until the handover is marked sent.
- **Committed** = the awarded total. Tiles show budget, committed, best quotes against budget and what needs a decision. Warn, never block, when committed exceeds budget.
- **Handover:** Excel per awarded package (supplier, lines, quantities, awarded rates, cost codes, project, round reference), "Mark as sent to ePROMIS" with date and who; ERP id line later via the middleware.
- **Supplier groups:** a group has a name, a linked client account (optional) and members. Managed from Suppliers (one place). A contract project and a tender deal use the group of their account.

## 4. Data (migrations numbered at build, from 0233)

- `supplier_groups`: id, tenant_id, name, account_id (nullable, unique per tenant when set), note, active, timestamps. `supplier_group_members`: group_id, supplier_id, tenant_id (unique pair).
- `project_buyout_packages`: id, tenant_id, project_id, ref `PKG-####`, name, kind (supplier, subcontract), status (draft, out, ready, awarded, handed_over), current_rfq_id, awarded_rfq_id, awarded_supplier_id, committed_amount, currency, award_reason, awarded_by, awarded_at, handover_sent_at, handover_sent_by, erp_ref, note, timestamps.
- `project_buyout_package_lines`: package_id, budget_line_id (unique per project), tenant_id.
- `rfqs.package_id` (nullable). Round number derived by created order.
- RLS: tenant SELECT only; writes by service role. Cost stays internal: no v1, MCP or Data Workbench surface.
- Degrade on 42P01 / 42703 / PGRST205 while migrations are pending.

## 5. API contract (both builders follow this)

All routes: `requireTenantUser()`, tenant-verified ids, `logChange`, project must be tender-origin with the module flags.

- `GET /api/contract-projects/[id]/buyout` -> `{ group: {id,name}|null, tiles: {budget, committed, best_vs_budget, needs_decision, packages}, packages: PackageRow[], unassigned_lines: BudgetLineRow[] }`. PackageRow: `{id, ref, name, kind, status, line_count, budget, bid_cost, best_quote|null, committed|null, against_budget|null, current_round, rounds, handover:{state:"not_ready"|"ready"|"sent", sent_at|null}}`.
- `POST .../buyout/packages` `{name, kind, budget_line_ids[]}` -> PackageRow. `PATCH/DELETE .../packages/[pid]` (name, lines; delete only when draft).
- `GET .../packages/[pid]` -> `{package, lines: [{item_no, description, qty, uom, cost_in_bid}], rounds: [{rfq_id, ref, round, created_at, created_by, status, quotes: [{supplier_id, supplier_name, total|null, lead_days|null, valid, lowest_valid, replied_at|null}]}], budget_bars: {...}, handover}`.
- `GET .../packages/[pid]/suppliers` -> the supplier picker list (group members only when the project's account has a group; flag `restricted: true|false`).
- `POST .../packages/[pid]/rounds` `{supplier_ids[], reply_by?, note?}` -> creates the RFQ round (reuses the RFQ create and send code; server rejects suppliers outside the group with 422 naming them).
- `POST .../packages/[pid]/award` `{rfq_id, supplier_id, reason?}`; `POST .../packages/[pid]/unaward` `{reason}`.
- `GET .../packages/[pid]/handover` (Excel); `POST .../packages/[pid]/handover` `{action:"mark_sent", erp_ref?}`.
- Supplier groups: `GET/POST /api/supplier-groups`, `PATCH/DELETE /api/supplier-groups/[id]`, `PUT /api/supplier-groups/[id]/members` `{supplier_ids[]}`; `GET /api/suppliers?group=` filter; account link validated against the tenant.
- Supplier restriction applies everywhere a tender RFQ picks suppliers: the Costing New RFQ composer (deal's account group) and the buy-out round (project's account group); the server enforces it, the picker hides the rest.

## 6. Screens

- **Buy-out tab** (contract project, after Budget): header chip "Suppliers from: <group>" (or "No approved list for this client"), four tiles, filters (All, Not sent, Out, Ready to award, Awarded, Handed over), package table; row opens the side panel (bottom sheet under 780 px): lines, RFQ rounds with quotes side by side, award, budget bars, handover. "New package" picks unassigned budget lines.
- **Suppliers:** a Groups tab (table; panel to name the group, link the client account, tick members).
- **Costing New RFQ:** the supplier list follows the deal account's group.
- **Budget tab:** a Committed column per budget line. **Overview:** one Buy-out progress card.
- **Phone:** cards; no sideways scroll.

## 7. Not in scope

Purchase orders and subcontract orders, approval, receipts, payments, progress certificates, accounting, supplier onboarding portals.

## 8. Open for KAMCO

Where each client's approved list comes from (so we can import it); who approves an award (we record who awarded, not a second approval); re-tender versus keep bid suppliers (parked).

## 9. Build order

A. Migration, libs and rules (groups, packages, rounds, award, committed maths, handover Excel). B. Routes per section 5. C. Buy-out tab and side panel; Suppliers Groups tab; picker restriction in the Costing composer. D. Budget Committed column and Overview card. E. Tests, capability facts, docs. About two working days of builder time plus live verification.
