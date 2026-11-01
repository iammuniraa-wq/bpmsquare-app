# KAMCO feedback: analysis and redesign (2026-10-29)

Source: the handover call and the owner's walk through every tender and contract-project screen. Mock-up: `kamco-feedback-redesign-mockup.html` (open it first; nothing here is built).

**What is already there** (6c): tender header + tabs (`pipeline/[id]`), `BoqTab`, `CostingTab`, `BidsTab`, `DealRoom`, `competitors/*`, estimate screen (`estimates/[id]`), contract project overview/budget/buy-out/variations/invoicing (`components/contractProjects`). The redesign reuses all of them; it changes layout, naming and where things start, not the data.

**Verdict:** every point makes sense. Nearly all are one of five causes, so five fixes cover them.

## The five causes

| # | Cause | Fix |
|---|---|---|
| A | No guided path: a tender has 8 tabs and no start or end | One stepper above the tabs, per stage, with one "next step" button and a done-checklist |
| B | Words without a meaning | Rename and add an "i" on Source, Mk, Rate, Linked, Stale, Weighted, Budget, Committed, Invoiced |
| C | Same information repeated | Costing "Prices" rows, estimate "start from email", origin cards, the three headline chips |
| D | Too big for what it says | Costing cards become one table; chips and graphs collapse; two graphs become one |
| E | Dead ends and misalignment | Back links to where you came from; one toolbar baseline; Create quote only when it applies |

## Point by point

### Tender: header and flow
| Your point | Makes sense? | Today | Change |
|---|---|---|---|
| Flow unclear, start and end | Yes | 8 tabs, header button follows stage but nothing shows the whole path | **Stepper**: Received, Decision, BOQ, Costing, Bid, Submitted, Awarded, Project. Current step highlighted; each step shows its own done-checklist; one primary button |
| Collapse the chips | Yes | Several chips always open | One "Details" row, collapsed by default, remembers its state |
| BOQ execution / WBS (Khader) | Yes, not clear yet | Buy-out packages exist after the project is approved; no WBS | Park as design: after Won, group BOQ lines into **work packages** (WBS) and assign each to an employee. Needs one question to Khader (below) |
| Email stays in the system | Yes | Email reads/sends via connectors; tender shows the source email | Design: all tender mail goes through the tender (sent and logged there), with an "Only through BPMSquare while bidding" switch on the tender. Confirm meaning first |

### Bill of quantities
| Your point | Today | Change |
|---|---|---|
| Toolbar misaligned (Upload revised BOQ, Markup, Price all lines up/down) | `alignItems: flex-end` with a Field label above only one control | One row, controls share a baseline; label inside the field |
| "12 lines not priced" pill belongs in the Lines/Priced chip | Separate strip beside the stat tiles | Merge into the **Priced** tile ("9 of 12, 3 to price") |
| Source, Mk, Rate, Linked, Stale unclear | Column heads with no explanation | Source = where the cost came from. **Markup %** = added on cost. **Rate** = selling price per unit (Amount = Rate x Qty). **Linked** = tied to a catalog product so supplier/BOM prices can find the line. **Stale** = price older than the validity days. Each gets an "i"; Linked is renamed **Product** |
| Row panel: text box and button not aligned | Input and button in a flex row without a shared height | Same height (44), same baseline |
| Can the cost be edited by hand? Where? | Rate yes (saved as Manual); cost only via Costing | Add visible **Edit cost** in the row panel (saved as Manual cost, keeps the replaced source) |
| Where does Price all take prices from? | Hidden | A short "How it works" line under the button: supplier, BOM, past project, in that order; fresh only; what was left is listed |
| Show only a few lines | Costing shows 8 then "show all" | See Costing |

### Costing
| Your point | Change |
|---|---|
| Why so big, only few lines | Replace the tall cards by **one table**: Type, Reference, Prices (n rows), State, Cost, Age, Open. Show 10 rows, then "show all" |
| Price more BOQ rows: unclear | Becomes a column "Prices rows 1.1, 2.1 +8" and one action **Add rows**; the BOQ shows which rows have an estimate or RFQ |
| What is "attached costing" doing | Rename "Estimates and RFQs" to **Cost sources** and put a one-line "i": each BOQ row takes its cost from one source |

### Estimate
| Your point | Change |
|---|---|
| Create quote on the right, why | From a tender it is not the end. Show **Back to BOQ line 1.1** and **Apply to BOQ** instead; Create quote appears only for a standalone estimate |
| Cannot go back to the BOQ | Back link to the tender BOQ (it has `dealCtx` already; it links to the Estimates tab, change to the BOQ row) |
| "Start from email" is not always relevant | Collapsed "Source" section, closed when the estimate came from a BOQ row |

### Bid tab
| Question | Answer to show in the app |
|---|---|
| What does Submit bid do | Saves lines and total as the next numbered version, moves the tender to Submitted. Cost and markup are never saved. Shown in the submit dialog |
| Where is the outgoing email recorded | Today: nowhere on the tender. **Add** "Sent to client" entries on the Bid tab and in History (date, who, file) |
| How are versions updated | Revise bid returns to Estimating; next Submit is v+1 with a reason. A one-line explanation next to the version list |
| Documents we send | Priced BOQ = the client's file with your rates. Answer sheet = plain Excel for portals. Add **Send by email** next to Download (through the tender, logged) |

### Deal Room and Competitors (revised 2026-10-29)
| Point | Change |
|---|---|
| Room is scattered | Room gets four **sub-tabs** (`useUrlTab`): **Discussion** (messages), **Team** (members, add person, Internal / With client switch), **Decisions** (pinned one-liners), **Documents** (files shared in the room) |
| Open questions not needed | Removed from the Room. The Overview "open questions" count and the "Open work" list stop listing them; existing question rows stay in the database, unused |
| A client contact in the room | Team sub-tab: switch the room to With client and add the contact; client-visible messages are marked |
| Competitors | Stays its **own tab**. The list shows only **Company, Expected price, Status** (Proposed / Added by you). **Click a row** for evidence with source links, strengths, wins against us, likely price against our bid, and the actions (Accept, Reject, Edit, Remove) in a side panel (bottom sheet on phones). No big chips |
| AI-proposed competitors | **Suggest from market research** builds on the existing company analysis (`src/lib/analysis`, the card's "Company insights"). It first **asks what it needs** (supply or install, region, issuer type) when the tender does not say. Every fact carries a **source link**; where nothing is found it says Unknown, never a guess. Results are **Proposed** and are saved only when the user accepts; the user can also add, edit and reject. Added-by-you and Proposed are labelled |
| No hallucination | Rules: facts only from fetched pages the model cites; a fact with no source is dropped; prices and win history show "not found" unless a source states them; the tool-fetch goes through the existing safe fetch and thin-result checks |

### Contract project
| Point | Change |
|---|---|
| Back goes to all projects | Back link to the tender (and the tender shows the project) |
| Show the tender it came from | Origin line in the header ("From TEN-0025, bid v1") instead of a card |
| Chips at top: collapsible, budget chips combined | One strip: Contract value, Budget, Margin (3 tiles, collapsible) |
| Overview crowded, 2 graphs take half the screen | One graph: budget against contract value with the cost-type split inside the budget bar; named **Where the budget goes** |
| Needs attention and approval at the top | Moved to the top as one banner row |
| What are those details | Collapsed "Project details" at the bottom |
| Budget section unclear | Header line says what the tab is for; "Committed/Actual" renamed **Ordered / Spent** with "i" |
| Buy-out chips unclear, budget in packages | Rename "Budget" to **Budget of these packages**; show 3 tiles only: Packages, Ordered vs budget, Needs decision. Complexity shown as a package table |
| Variations: whose? why add by hand | These are **client change orders** (not package changes); tab renamed **Client changes**. Automatic budget-change detection is a new design (a variance feed from buy-out): not in this first pass |
| Invoicing: we buy, not sell | In a contract project BPMSquare **sells** to the client (billing) and **buys** from suppliers (buy-out). Rename the tab **Client billing**; add a line saying so |
| Billing schedule: where defined | Created in the same tab; make "Add milestone" the main action and offer **Copy the tender's payment terms** |
| Handover into chips | Handover becomes a step in the project stepper |
| Contract project shown inside the tender | It appears only **after the tender is won**. The tender stepper ends at **Won or lost**; once won, the header shows one **Contract project** link and the project shows its tender (the back link above) |

## Decision 2026-10-29: the budget is allocated by people, not created by the system

Owner: "Let's not have the system create the budget. User allocates the budget, we deduct it from the contract value and update the margin live."

| Today | New |
|---|---|
| Creating the project copies every tender line into the budget with a cost (recorded, else rate less default margin, "Estimated") | Creating the project makes the **contract** (value, lines, client rates) and an **empty allocation**. No cost is guessed |
| Planned margin = contract value less budget total, from system-made lines | **Planned margin = contract value less what has been allocated so far**, recalculated on every change |
| "Estimated" flag, default margin setting | Not needed: a line is Allocated or Not allocated. The default-margin setting (Settings > Contract projects) is removed |

**How it works on screen** (mock-up screen 6): a header of three live figures (Contract value, Allocated, Margin), a bar that fills as money is allocated, a table of BOQ lines with the client's amount and an **Allocated cost** the user types, with the remaining amount per line and in total. Margin turns amber under a floor the workspace sets and red when over-allocated. Until something is allocated the margin shows "Not allocated yet", never 100%.

**Unchanged:** baseline approval locks the allocation; later changes are revisions with a reason; resource type, cost code, WBS reference, reserve line; buy-out reads the allocated amount as "budget of these packages".

**Decided 2026-10-29 (owner)**
1. **The user chooses the basis per project: BOQ line or Work package.** Shown as a switch on the allocation screen ("Allocate by"). By line, a cost is typed on each BOQ line. By package, a cost is typed on each work package and its lines show only the client amount. Switching is allowed until the baseline is approved and clears typed amounts after a confirm; the package grouping is kept.
2. **WBS creation is in.** The user builds work packages (code, name, owner = a workspace employee) and puts BOQ lines in them; a line sits in one package; unassigned lines are listed and warned. This answers Khader's "combinations of BOQ assigned to internal employees". An owner sees their packages and what is left on each. Package mode is optional: a project can stay on BOQ lines.
3. **"Fill from tender costs" is in**: one button, copies the recorded costs once (summed per package in package mode), never automatic.
4. **Existing KAMCO data is seed data**: CPR-0002 and the other test projects are updated or recreated, no migration of "estimated" flags is built.

**What changes in code (not started):** `fromTender.ts` creates lines with qty and rate but no cost; `budget.ts` `plannedMargin` unchanged in formula but the totals count only allocated lines; the Overview "estimated" warnings and `estimateUnitCost` go; Budget tab becomes the allocation screen; tips and tests updated; Drive docs updated after you validate.

## Build order (after you approve the mock-up)

1. Wording and "i" pass (cause B) + alignment (E): no data change, low risk.
2. Tender stepper + collapsible chips (A, C).
3. BOQ and Costing redesign (D).
4. Estimate back links and Source collapse.
5. Contract project overview, tabs renamed, back links.
6. Competitors comparison; Deal Room two-pane.
7. Design docs only (no code yet): WBS and work packages, tender email lock, two Ariba tenants, ERP cost import (costs stored in BPMSquare, refreshed by the middleware, not live calls).

All screens checked at 375 px and on PC before they are called done.

## Questions for you
1. WBS: after the win, is it "split the BOQ into work packages and assign each to an employee", or something about execution progress?
2. Email lock: block outside email on the tender, or log every exchange?
3. Ariba: two business units or two customers?
