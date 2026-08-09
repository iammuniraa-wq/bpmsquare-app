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

**B. `claude/new-session-2cctvi` → `develop` (this session, 4 commits, not yet
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
  surprise.

**Decision: config-only fix, no code change.** Settings → Statuses already has a
self-serve "Closed" checkbox per status (built this session). Unchecking it on "PO
Received" for Vikas means the new closing-requires-an-outcome check never fires for
that status — it stops being treated as closed at all.

**Operational step, not a code/migration step:** after this reaches production, open
Settings → Statuses as the Vikas tenant (or as platform admin impersonating it) and
uncheck "Closed" on "PO Received," then Save. Do this **before** telling Vikas the
release is live, or the first user to move a quote there hits the 400 in the window
between deploy and the toggle.

**Accepted trade-offs of this choice** (spelling out what changes, so it isn't
rediscovered later):
- "PO Received" quotes stop being edit-locked — `QuoteEditPanel`'s lock is driven by
  the same `is_closed` flag. Previously locked, now editable indefinitely.
- Outcome is never auto-set to "won" for these quotes (that auto-derivation is gone in
  this session's redesign regardless of the checkbox — no config toggle can bring it
  back). If nobody clicks the separate Outcome pill by hand, `quoteOutcomeTotals` (the
  dashboard/reports "won value" tile, driven by `outcome`, not `status`) will
  under-report Vikas's actual won revenue.
- Net effect: "PO Received" becomes a purely informational label with no locking or
  outcome semantics, functionally equivalent to "Pending" except for the name. Worth
  a one-line heads-up to Vikas so they know to use the Outcome pill if they still want
  won/lost tracked.

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
4. **Immediately after deploy, before announcing anything to Vikas:** Settings →
   Statuses (as the Vikas tenant / platform admin impersonating it) → uncheck "Closed"
   on "PO Received" → Save. This is the §4 fix — a UI action, not a migration step, but
   it belongs in the release sequence, not as an afterthought.
5. **Post-deploy smoke test** — the existing checklist (§4 Step 4 of
   `MERGE_PLAN_develop_to_main.md`) already checks "log in as a Vikas user, navigation
   is exactly as before." Add one line specific to this addendum: **open an existing
   Vikas quote and move it to "PO Received"; confirm it succeeds with no error** (this
   is what step 4 above is verifying actually took effect).

## 6. Still open before pushing

- [ ] Security review of this branch's 4 commits (per the standing per-build cadence —
      not yet run this session on this work).
- [ ] Confirm Vikas's *current live* `quote_statuses` (not just the 0031 seed) with a
      quick read against production, same spirit as the existing plan's "confirm 0064–
      0067 already applied to staging" checklist item — in particular confirm "PO
      Received" is still the value/label in use today before relying on §4's steps.
