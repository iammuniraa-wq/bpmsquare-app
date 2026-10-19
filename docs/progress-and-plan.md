# BPMSquare — progress and plan (snapshot 2026-10-19, paused for usage limit)

> Read this first when resuming. It is the single place that says what is
> done, what is half-done, what is next and what the owner still has to
> decide. Update it at every pause.

## Working rules (owner)

- **Fable designs, Sonnet builds** (latest instruction, 2026-10-19). Opus is the
  main session. Design first (doc + clickable mock-up), owner approves, then build.
- **Nothing standalone**: every new capability is designed integrated with the
  suite; every design has an "Integration points" section; marketing umbrella
  is `docs/marketing-platform-architecture.md` (being written).
- **Simple screens, plain words**, engineering details tucked away (approved
  tone: `docs/estimator-reference/studio-mockup-v2.html`).
- Owner runs all SQL by hand (dev, then production). Never push without his go.
  Never stage `.claude/launch.json`, `src/app/login/LoginForm.tsx`,
  `src/lib/wfm/selfService.ts` (his uncommitted files).
- Ship sequence: security check, my own tsc + tests + build on the exact
  commit, push develop then main.

## Live on main (pushed)

| Area | State | Doc |
|---|---|---|
| UI restructure (kit, templates, 22 objects, settings revamp, navigation, tabs, typography, themes kept) | Live, owner validated "clean and easy" | `docs/ui-restructure-spec.md` |
| Inter font | Live | — |
| Search label "Employees" | Live | — |
| Spaces/Nova rail honour hidden nav items | Live | — |
| Project Estimator E1-E5 (engine, API, screens, simulation, simplified email-first flow) | Live behind flag `estimator` (off by default; platform admin enables per tenant). Owner: "works but needs a lot of improvement, later" | `docs/estimator-architecture.md` (§1-16) |

## Committed on develop, NOT pushed yet (push is the first resume step)

HEAD `5cc284dd`. Owner already said "push all as soon as this is done".

- **RFQ per-line** (`4a43732d`..`5b1e4937`): Request quotation action on every
  quote/deal line and on Quotation detail; current supplier (preferred on
  product, else last awarded, else last PO) pre-ticked; one-item form; RFQs
  always linked to quote + quote line + item (server-verified); Quote/Items
  columns in the RFQ list. Doc: `docs/rfq-architecture.md` §A2.
- **Preferred supplier on products** (`95b8ef5f`..`67215faa`): every surface;
  kept out of v1/MCP on purpose (test pins it).
- **Item types + BOM kits with cost roll-up** (`5aec526f`..`b3b65592`): item
  type on every surface + Settings → Item types; Components tab on BOM/kit only,
  roll-up (scrap, used vs consumed, missing costs = incomplete, depth 8, no
  loops), "Apply to product cost", "Used in" tab, Data Workbench for BOM
  lines. Doc: `docs/products-bom.md`.
- **D365 connector fixes** (`79207307`, `bf0312d6`, `01947515`, `43c153e7`,
  `5cc284dd`): review notes, vendor re-sync fix, safe write retries,
  certificate assertion to Microsoft's current spec, project push opt-in,
  sovereign clouds rejected clearly. Review in progress (see below).

**Resume step 1:** verify `5cc284dd` (or the D365 agent's final head once it
finishes) in a clean worktree (`git worktree prune`; old `../bpm-verify` and
`../bpm-main-wt` worktrees can be removed), run tsc + vitest + next build,
then push to develop and main.

## SQL status

| File | State |
|---|---|
| 0128-0131 | Applied dev + prod |
| 0132_product_supplier | Applied dev + prod (2026-10-19) |
| 0133_item_types_and_bom | Applied dev + prod (2026-10-19) |
| `scripts/seed-estimator-demo.sql` | Run on both after E5 (re-run after any regeneration) |
| 0130_rfq_purchase_orders | Check ledger: was pending earlier |

No new SQL is waiting.

## Stopped mid-work (resume with SendMessage; files are on disk)

| Work | Model | Where it stopped | Uncommitted files |
|---|---|---|---|
| D365 connector recheck + fixes + `docs/d365-connector-review.md` | was Opus → resume or hand to Sonnet | fixing a regex in catalog/server after 5 committed fixes | check `git status` under `src/lib/connectors/d365` |
| Process Design Studio design | Fable | doc written, mock-up next | `docs/process-design-studio-architecture.md` |
| Newsletter Studio design | Fable | doc + mock-up written, was verifying render | `docs/newsletter-studio-architecture.md`, `docs/design/newsletter-studio-mockup.html` |
| Signals (6sense-style) design | Fable | writing both files | none yet |
| Integrated marketing platform + automation design | Fable | research done, writing | none yet |

Order of resume: (1) push, (2) the four Fable designs (marketing platform
first so the others align to it), (3) D365 review to finish, (4) queued builds.

## Queued (build on Sonnet after the push)

1. **Estimator uses real products and BOM kits as items**, not blank rate
   lines: demo precast products and BOM kits, starter template rules priced
   from them, seed regenerated.
2. **Demo pricing set-up** for the demo tenant: a catalogue + formula price
   book and a cost-plus price book (pricing engine, `docs/pricing-engine-architecture.md`).
3. After owner approves each design: Marketing platform (automation journeys,
   lead scoring + lifecycle + assignment via Coverage, forms + landing pages,
   one consented web snippet, engagement tracking, preference centre; later
   WhatsApp, attribution, events), Newsletter Studio, Signals, Process Design
   Studio — built in the order the marketing blueprint sets.

## Branches from side tasks (owner started them; not merged)

`feat/segment-coverage-signals` (segment fields that never matched),
`fix/marketing-workcenter-gates` (Business Role on campaign pages),
`fix/wfm-initial-data-scope` (supervisor first-paint scope),
plus the technician "Edit profile" save task. Review and merge each into develop.

## Open items waiting on the owner

- Drive guides: Admin & Setup, API, Marketing, Sales published (Oct 2026
  versions); Service and Workforce drafts held for his answers (8 service gaps,
  6 workforce items); new guides needed later for RFQ per-line, products
  supplier/BOM, estimator — only after he validates.
- His uncommitted login-cleanup files: keep or discard.
- `RFQ_LINK_SECRET` in Vercel (Preview and Production, different values).
- AI usage metering does not exist (no credits helper); needed before paid
  clients use AI features (estimator intake/review, RFQ reader, fence draft).
- Estimator open items: glTF/IFC upload (IFC needs `web-ifc`, needs his go),
  AI image render provider, ERP push, RFQ from estimate lines, PDF/image
  briefs.
- BOM not built yet: versions, stock consumption, RFQ from BOM components, ERP
  BOM export, auto re-apply of cost.
- PCBS: discovery questions prepared but not asked (his choice); D365 live test
  needs an environment from his side.

## Marketing gap list agreed (vs Marketo and 6sense)

Automation/nurture, lead scoring + lifecycle + assignment, forms and landing
pages, website tracking with consent, engagement tracking, preference centre,
WhatsApp marketing, attribution to revenue, events; from 6sense: account
identification, intent, buying stage, orchestration, alerts, reach reports
(paid intent data and ads platform later). All to be designed as one
integrated platform.
