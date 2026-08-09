# Merge plan addendum — this session's work vs. `MERGE_PLAN_develop_to_main.md`

> Written from `claude/new-session-2cctvi`, comparing it against `origin/develop`
> (94918b7) and `origin/main` (bdbcdd4). `MERGE_PLAN_develop_to_main.md` (owner-authored,
> 2026-08-06) only exists on `develop` today — it is not this document, and this
> document does not replace it. This addendum covers what changes once THIS session's
> two bodies of work (Quote status/outcome, and status-schema-engine Batch 0) are folded
> into that existing plan.

---

## 1. There are two separate, independent bodies of unmerged work

**A. `develop` → `main` (53 commits, already planned).** WFM (the whole module),
Standard Business Roles, the read-only AI assistant, per-module subscription flags, a
filters/charts/theming pass. Fully covered by `MERGE_PLAN_develop_to_main.md` on
`develop` — risk table, migration order (0062–0067), env vars, rollback, a post-deploy
smoke-test checklist that explicitly checks "log in as a Vikas user, navigation is
exactly as before." That document is thorough and correct; nothing here overrides it.

**B. `claude/new-session-2cctvi` → `develop` (this session, 3 commits, not yet
pushed).** Quote status/outcome redesign + status-schema-engine Batch 0. Never went
through the standing convention (work branch → push → security review → ff-merge to
develop → promote to main) — it's sitting local-only. This addendum is about getting
THIS onto develop safely, so it rides along with (A)'s already-planned promotion.

## 2. Verified compatibility — no blockers between (A) and (B)

Checked in a disposable worktree (`git worktree add --detach`, discarded after — no
real branch touched):

- Merging this branch into `origin/develop`: **clean auto-merge, zero conflicts**,
  including the files both sides independently edited (`src/lib/constants.ts`,
  `src/lib/data/live.ts`, `DashboardLayout.tsx`, `ReportsClient.tsx`, `types.ts`,
  `labels.ts`).
- The combined tree (develop's WFM/roles/flags + this session's status work) passes
  `npx tsc --noEmit` **and** a full `npx next build` cleanly. No naming collisions, no
  type errors.
- **One real problem, now fixed on this branch:** both sides independently used
  migration numbers 0062–0064 (`develop`: WFM module, RLS narrowing, leave requests;
  this branch: quote outcome, quote status, status-schema engine). Not a git conflict
  (different filenames), but a real numbering collision that would leave two unrelated
  "0062" files side by side. Renumbered this branch's three migrations to **0068, 0069,
  0070** (after develop's 0067) — develop's numbers are already applied to staging per
  its own merge plan; this branch's were unapplied anywhere, so they're the ones that
  had to move. Commit `4bd42ef`.

## 3. Risk table for this branch's own two changes

Same format as `MERGE_PLAN_develop_to_main.md` §2, extending it:

| Area | Risk | Why |
|---|---|---|
| Status-schema engine (Batch 0: 6 new tables + `statusEngine.ts` + hook registry) | **None** | Purely additive. No route, page, or component reads or writes these tables yet — confirmed by grep, nothing imports `statusEngine.ts` outside itself. Safe to merge and migrate in any order relative to everything else. |
| Quote status/outcome redesign (`is_closed` flag, independent `outcome` incl. new `dropped` value, shared v1/in-app validation) | **Medium — immediate, unflagged, live for every tenant including Vikas the moment 0068/0069 run** | Unlike everything in `MERGE_PLAN_develop_to_main.md`, this is **not** behind a `TenantFeatures` flag. It changes real, already-live behavior. See §4 for the concrete Vikas-specific finding. |

## 4. Concrete finding: Vikas's own configured pipeline is affected

`supabase/migrations/0031_copy_vikas_pioneers_entity_profile.sql` seeded Vikas
Pioneers' `tenants.config.quote_statuses` with:

```json
[
  {"value": "draft",       "label": "Draft",       "is_initial": true},
  {"value": "pending",     "label": "Pending"},
  {"value": "po_received", "label": "PO Received", "is_terminal": true}
]
```

(This is the seed value from tenant creation — the live value may have been edited
since via Settings → Statuses, but Vikas is confirmed to have a **customized**
pipeline, not the code default.)

- **The data migration itself is clean.** 0069 backfills `is_terminal → is_closed`; no
  `is_lost` was ever set on Vikas's rows, so nothing is lost or ambiguous in the
  transform.
- **The behavior change that follows is real.** Before this session's change, moving a
  quote to "PO Received" silently auto-set `outcome = "won"`. After, `outcome` is never
  auto-derived — the PATCH is **rejected with a 400** ("Set an outcome before closing
  this quote") unless the caller already has, or explicitly sets in the same request, a
  decided outcome. Vikas's `StatusChanger` UI (the status pill dropdown) does **not**
  bundle an outcome into that request. The first time a Vikas user moves a quote to "PO
  Received" after this deploys, they will see a new, unexplained error where the action
  previously just worked.
- This is explicitly what you flagged as "(except status schema)" — I'm not blocking on
  it, just making sure it's a known, specific, verified fact rather than a hidden
  surprise. Two ways to close it, your call:
  1. **Ship as-is** and tell Vikas: closing a quote now requires picking Won/Lost/Dropped
     first (the `OutcomeChanger` control already exists on the same page).
  2. **Small follow-up** (not done, ~1 file): have `StatusChanger` detect "moving to a
     closed status with outcome still open" and prompt for the outcome inline instead of
     round-tripping to a 400. I'd size this as small if you want it before this reaches
     Vikas specifically.

## 5. Merge sequence (what actually needs to happen, in order)

1. **This branch → `develop`.** Push `claude/new-session-2cctvi`, run the standing
   security-review pass (not yet done this session — the earlier security review this
   session covered the change-history feature, not this work), then ff-merge to
   `develop`. Verified clean (§2); no blockers expected.
2. **`develop`'s existing plan proceeds as written** — `MERGE_PLAN_develop_to_main.md`
   §4 Step 1 (run 0062–0067 in the production Supabase SQL editor, in order,
   **before** any deploy) now additionally includes **0068–0070** at the end of that
   same batch (all additive, same "migrations first, deploy second" rule applies).
3. **Deploy `main`** per that plan's Step 3.
4. **Post-deploy smoke test** — the existing checklist (§4 Step 4) already checks "log
   in as a Vikas user, navigation is exactly as before." Add one line specific to this
   addendum: **open an existing Vikas quote and move it through its full status
   pipeline once (Draft → Pending → PO Received), setting an outcome when prompted** —
   this is the one behavior change in this whole release that isn't covered by the
   existing smoke test.

## 6. Still open before pushing

- [ ] Security review of this branch's 3 commits (per the standing per-build cadence —
      not yet run this session on this work).
- [ ] Decide §4's two options (ship as-is + tell Vikas, or the small `StatusChanger`
      UX follow-up) before this reaches Vikas specifically.
- [ ] Confirm Vikas's *current live* `quote_statuses` (not just the 0031 seed) with a
      quick read against production, same spirit as the existing plan's "confirm 0064–
      0067 already applied to staging" checklist item.
