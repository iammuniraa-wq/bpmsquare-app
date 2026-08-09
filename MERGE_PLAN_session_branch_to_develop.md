# Merge plan — `claude/new-session-2cctvi` → `develop`

> Written 2026-08-09. Supersedes `MERGE_PLAN_ADDENDUM_status_and_outcome.md` (kept
> for its Vikas-specific background, but this document is the current, complete
> plan — it includes everything that addendum covered plus the sort/filter work
> added afterward, and a **verified, tested conflict-resolution recipe** for every
> file that actually conflicts). Follows the same shape as the owner's own
> `MERGE_PLAN_develop_to_main.md` (on `develop`) since that document proved the
> right structure for this repo's release process. This is the develop-bound half
> of the pipeline; once merged, this branch's work rides along with develop's
> next promotion to `main` under that existing document's process.

Scope: 6 commits on `claude/new-session-2cctvi`, still entirely local — **nothing
has been pushed**. Three units of work:

1. Quote status/outcome redesign (`is_closed` flag, independent `outcome` incl.
   new `dropped` value, shared validation between the in-app and v1 API routes).
2. Status-schema engine Batch 0 (6 new DB tables + `statusEngine.ts` — purely
   additive infrastructure, nothing reads or writes it yet).
3. Quote versions tab, an Invoices feature-flag bug fix, and column sorting +
   filtering added to all 13 object list pages.

---

## 1. The one thing that will actually block a plain merge

**6 files conflict, all in the same shape.** `develop` independently built its
own filtering for several objects (status search, date ranges, the same "dead
Technicians status filter" bug this branch also found and fixed) as part of its
own recent work — real, substantive overlap with this branch's sort/filter
rollout, not just adjacent code. A plain `git merge` will stop with content
conflicts in:

- `src/app/(app)/assets/page.tsx`
- `src/app/(app)/invoices/page.tsx`
- `src/app/(app)/purchase-orders/page.tsx`
- `src/app/(app)/standard-quotes/page.tsx`
- `src/app/(app)/technicians/page.tsx`
- `src/app/(app)/work-orders/page.tsx`

**This has already been fully resolved once, in a disposable git worktree, and
verified** (`npx tsc --noEmit` and a full `npx next build` both clean on the
resolved result, including every WFM route). §3 below is the exact recipe —
apply it verbatim at real merge time rather than re-deriving it.

**Important nuance confirmed by that dry run: git's auto-merge silently
duplicates non-conflicting-but-overlapping additions.** In 4 of the 6 files
above, both branches added their own `<ListFilterBar>` invocation and their own
`import ListFilterBar` line in *different* parts of the same file — git doesn't
flag this as a conflict (the line ranges don't overlap), so a naive merge would
silently ship two duplicate filter bars stacked on the page and a duplicate
import. **Every file in §3 needs a full read-through after resolving the marked
conflicts, not just a fix at the `<<<<<<<` markers.**

`ListFilterBar.tsx` itself (this branch's ported copy vs. develop's original)
merges with **zero conflict** — content is byte-identical, git resolves the
add/add silently. No action needed there.

---

## 2. Risk assessment

| Area | Risk | Why |
|---|---|---|
| Status-schema engine (Batch 0) | **None** | Purely additive, nothing wired to it yet. Confirmed via a fresh merge-tree test this session: merges clean, tsc/build clean on the combined tree. |
| Quote status/outcome redesign | **Medium — immediate, unflagged** | Not behind a `TenantFeatures` flag, unlike everything `develop`'s own `MERGE_PLAN_develop_to_main.md` ships. Real behavior change for Vikas specifically (closing a quote to their "PO Received" status now requires a decided outcome). **Already decided**: config-only fix via Settings → Statuses (uncheck "Closed" on that status) — see `MERGE_PLAN_ADDENDUM_status_and_outcome.md` §4 for the full writeup and trade-offs. Not a merge blocker, an operational step for right after this reaches Vikas. |
| Quote versions tab + Create Invoice feature-flag fix | **Low** | UI-only / a stricter gate on an existing route. No schema, no migration. |
| Sort/filter rollout (13 objects) | **Medium, self-contained to the merge step** | The 6 conflicts in §1 are real but mechanical and already resolved+verified once (§3). Risk is entirely "did the merge-time resolution match the verified recipe," not "does the feature work." |
| Migration numbering | **None — already handled** | This branch's three migrations were renumbered 0062→0068, 0063→0069, 0064→0070 specifically to sit after develop's existing 0062-0067 (commit `48cbc50`). No collision. |

---

## 3. Conflict resolution recipe (verified — apply this exactly)

Every one of the 6 conflicts follows the **same underlying pattern**: `develop`
added real search/filter logic (and in Assets/Invoices/Technicians, more than
this branch's own research had assumed — verify against develop's actual code
at merge time, not against any earlier research notes) plus, in every file,
`requireFeature(...)` calls from develop's per-module subscription-flag work
(0067) that this branch's code predates. This branch added `sort`/`dir` params,
a `SORT_EXTRACTORS` map, and either `SortableTh` (tabular pages) or a "Sort by"
`ListFilterBar` select (card/row pages: Assets, Technicians, Work Orders).

**The rule for all 6: keep develop's filter/search/`requireFeature` logic as
the base, layer this branch's sort additions on top, then delete whichever
`ListFilterBar` block/import ends up duplicated.** Concretely, per file:

- **`assets/page.tsx`** — keep develop's serial-inclusive search + `requireFeature("assets")`. Add `sort` to the searchParams type, add the `SORT_EXTRACTORS` const and `sortRows(...)` call from this branch. There are two `<ListFilterBar>` blocks after auto-merge (one with just `kind`, one added by this branch with `kind`+`sort`) — keep only the one with both selects, delete the other, delete the duplicate `import ListFilterBar` line. Also fix a stray BOM character before the `Link` import that a botched auto-merge introduces (`grep -n "^\xef\xbb\xbf"` or just eyeball the first few lines).
- **`invoices/page.tsx`** — keep develop's `from`/`to` date-range filtering + `requireFeature("invoices")`. Add `sort`/`dir` to the type, `readSortParams`, `SORT_EXTRACTORS`, and `sortRows(...)`. Two duplicate `<ListFilterBar>` blocks again (one with dates, one without) — keep the one with `dates`, delete the other and the duplicate import. Every `SortableTh`'s `hiddenParams` must include `from`/`to` alongside `status`/`q`, or sorting silently drops the active date range.
- **`purchase-orders/page.tsx`** — keep develop's search (which also matches on `r.po.id`, not just `ref`) and its `status !== "all"` handling. Add `sort`/`dir` + `SORT_EXTRACTORS` + `sortRows`. Two duplicate filter bars — keep the first (outside the card container), delete the second (which was nested oddly inside the `cardStyle` div).
- **`standard-quotes/page.tsx`** — mechanically the simplest: no duplicate filter bar here, just merge the `searchParams` type, keep `requireTenantUser()` for `role`, add `readSortParams`/`SORT_EXTRACTORS`/`sortRows`. One cosmetic-only conflict (search placeholder wording) — either wording is fine, no functional difference.
- **`technicians/page.tsx`** — the most involved. Keep develop's entire WFM live-status integration (`getTenant`, `requireFeature("technicians")`, `getTechnicianLiveStates`, `TechnicianLiveBadge`, the `tenant?.features?.wfm` gate) — **do not drop any of it**. Note develop independently fixed the exact same "status filter exists but has no UI" bug this branch's own Technicians work fixed — same root cause, found twice, only one fix survives the merge (develop's, since it's more complete). Add this branch's `sort` param + `SORT_EXTRACTORS` + `sortRows(...)` call. Merge the two `<ListFilterBar>` blocks into one with both the `status` select (develop's) and the `sort` select (this branch's) — delete the second block entirely.
- **`work-orders/page.tsx`** — smallest conflict: just add `requireFeature("work_orders")` back (develop added it, this branch's version predates it) alongside destructuring `q`/`sort`. Everything else here merges cleanly already.

After resolving all 6: grep the whole `src/` tree for leftover `<<<<<<<`/`=======`/`>>>>>>>` markers (confirmed clean in the verified dry run, but re-check — a real merge may not be byte-identical to the dry run if develop moves before this actually merges), then `npm install` (a fresh worktree/clone needs its own `node_modules`) and run `npx tsc --noEmit` and `npx next build`. Both must be clean before committing the merge — this is the actual bar that was verified this session, not a lower one.

---

## 4. Pre-merge checklist

- [ ] Confirm `origin/develop` hasn't moved since this plan was written (94918b7 at time of writing) — if it has, re-run the dry-run merge in a disposable worktree before trusting §3's recipe verbatim; new develop commits could touch the same 6 files again.
- [ ] Security review of this branch's 6 commits (per the standing per-build cadence — not yet run this session on any of this work).
- [ ] Push `claude/new-session-2cctvi` to origin (currently local-only).
- [ ] Apply §3's resolution to all 6 files, exactly as described (not re-derived from scratch).
- [ ] `npm install` + `npx tsc --noEmit` + `npx next build` clean on the merge result.
- [ ] Confirm Vikas's *current live* `quote_statuses` config (not just the historical 0031 seed) before relying on `MERGE_PLAN_ADDENDUM_status_and_outcome.md`'s Settings-toggle operational step.

## 5. Merge steps

```
git checkout develop
git pull
git merge claude/new-session-2cctvi
# resolve the 6 files per §3
npm install
npx tsc --noEmit -p tsconfig.json
npx next build
git add -A
git commit   # standard merge commit, no --no-verify
git push origin develop
```

Then this branch's three migrations (0068-0070) join develop's existing
migration queue, to be applied to production in sequence with whatever
`MERGE_PLAN_develop_to_main.md` is current at the time develop next promotes to
`main` — all three are additive (widen a CHECK, backfill a JSONB flag rename,
create 6 new unused tables), same "migrations first, deploy second" discipline
that document already establishes.

## 6. Post-merge verification (on develop / staging)

- [ ] Open Quotations list, click every column header, confirm sort direction
      toggles and the arrow indicator updates.
- [ ] Open Assets, Technicians, Work Orders — confirm the "Sort by" dropdown
      works and the existing kind/status filters (develop's) still work
      alongside it.
- [ ] Open Invoices — confirm the date-range filter (`from`/`to`) still works
      and that sorting a column preserves an active date range/search/status
      filter (this is exactly the kind of thing a dropped `hiddenParams` entry
      would silently break).
- [ ] Confirm Technicians' status filter is reachable via UI (the bug both
      branches independently found and fixed) and that the WFM live-status
      badge still renders for the demo tenant.
- [ ] Open a Quote, confirm the new Overview/Versions tab renders and the
      Versions tab shows prior revisions correctly.
- [ ] Confirm "Convert to Invoice" is hidden for a tenant without the
      `invoices` feature (or visible for one that has it) — this is the
      feature-flag bug fix, easy to silently regress in a bad merge resolution.

## 7. Rollback

Same asymmetry as `MERGE_PLAN_develop_to_main.md` §5: the code side of this
merge reverts cleanly (`git revert -m 1 <merge-commit>`). The three migrations
(0068-0070) are additive — never revert them once applied; they're harmless to
leave in place even if the code is rolled back (old code simply doesn't read
the new columns/tables).

## 8. Known follow-ups (not blockers)

- The status-schema engine (Batch 0) is unused infrastructure until a later
  batch wires an object onto it — see `/root/.claude/plans/curious-chasing-quokka.md`
  for the full rollout plan (pilot objects → generic admin UI → PO/WO →
  invoices → WFM → quotes → cases), not yet started beyond Batch 0.
- Whether to add the `StatusChanger` inline outcome-prompt UX improvement
  (rather than the Settings-toggle workaround already decided for Vikas) is
  still open — see `MERGE_PLAN_ADDENDUM_status_and_outcome.md` §4.
- This branch's sort/filter work only covers the 13 objects explicitly in
  scope. `leads`/`amc` (which already had `ListFilterBar` on develop) were not
  touched and still have no column sorting — a natural next increment if
  sorting should reach full parity with filtering coverage.
