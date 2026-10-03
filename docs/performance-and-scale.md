# Performance & scale

> Written 2026-10-03, after BIM — 84 employees — took the whole app down for a
> day. The point of this document is the first section: a hundred users is a
> small workload, and every problem we hit was self-inflicted. Nothing here
> needs bigger infrastructure.

---

## 1. Why 100 users was slow

Not volume. BIM's entire presence-event table was **5,305 rows / 3.4 MB**, and
September held **4,622 events**. Postgres was idle throughout — checkpoints
wrote 0.0–0.2% of buffers while functions ran for eight minutes.

Four separate faults, one shared shape: **work repeated per request that had no
business being repeated**, with nothing measuring it.

| What | Measured |
|---|---|
| `Intl.DateTimeFormat` rebuilt per call, inside a per-event-per-date loop | 100k calls: **16,199 ms** unmemoised vs **~300 ms** memoised — 54× |
| `/wfm/me` (the punch screen, and the landing page for every role) eagerly fetched all 7 tabs, one of which ran **7 full monthly summaries** | ~200 concurrent monthly summaries during the morning punch rush |
| A diagnostic tracer left in `requireTenantUser()` | 4–5 log lines on *every* authenticated request, app-wide |
| Platform-admin branch upserts `tenant_users` | a database **write** per request, for admins |

Vercel Fluid packs several requests into **one 2048 MB instance**
(`concurrency: 4–5` in the logs). So a single heavy route doesn't just fail
itself — it exhausts the shared pool and kills every request riding with it.
That is why punch and middleware appeared broken: they were passengers.

Daily provisioned memory went from a 5–8 GB-Hrs baseline to **38**, and roughly
15 of that was the failures themselves (a 500 s request at 2 GB ≈ 0.28 GB-Hrs).

---

## 2. The rules

These are what stop it recurring. They are cheap to follow and expensive to skip.

**R1 — Per-request work must not scale with tenant size unless it is paginated.**
A list page fetches a page, not a table. "It's only a few hundred rows" is how
every one of these started.

**R2 — Build expensive objects once, not per call.**
`Intl.DateTimeFormat`, regexes, clients. Memoise by a key that is a pure
function of the input (an IANA timezone, not a tenant id — see
`MULTI_TENANT_GUARDRAILS.md` on caching).

**R3 — Fetch on demand, not eagerly.**
A tab's data loads when the tab opens. `/wfm/me` preloaded seven endpoints for
a screen most people use to press one button.

**R4 — Treat the instance as shared.**
Under Fluid, a route that allocates 2 GB is everyone's outage. Every route gets
a `maxDuration`; anything unbounded (a pagination loop, a date walk) gets a hard
cap that **throws** rather than letting the reaper kill the process — a
SIGKILL'd instance loses its log buffer and tells you nothing.

**R5 — Every route has a budget, and something notices when it is breached.**
Target: **< 1 s at 10× today's data**. Not a per-request tracer (that was its
own problem) — a threshold logger that fires only over budget.

**R6 — Measure before restructuring.**
A day-facts/materialisation layer was designed and parked on 2026-09-24,
correctly: at 3.4 MB it would have been infrastructure for a problem years
away. Revisit only when measurement says reads are the cost. Trigger: a single
tenant-month passing ~50k events, roughly 10× BIM today.

---

## 3. Sequence

### Phase 0 — remove what is actively costing us (today)
1. **Delete `src/lib/trace.ts`** and its call sites. Replace with a
   slow-request logger that fires only past the R5 budget.
2. **Memoise the four remaining `Intl.DateTimeFormat` sites** —
   `wfm/server.ts` 184, 207 (`dateKeyInTz`, on the live-board and punch-state
   paths), 429, and `saturdayRule.ts` 10. Same fix as `hours.ts`.
3. **Stop the per-request platform-admin upsert.** Write only when the
   membership row is missing or its role is wrong, not on every request.

### Phase 1 — what BIM actually reported (today)
4. **Punch buttons**: visible pressed state and larger targets. Today `opacity`
   keys off `can` but never off `busy`, so a tapped button looks unchanged and
   people press it repeatedly.
5. **Tenant-editor user list**: search + pagination. *(done)*

### Phase 2 — measure, then decide (this week)
6. Slow-request budget logger (R5) live in production.
7. **Time the kiosk** `/identify` and `/punch` before changing anything. Each
   uploads a camera frame and runs a face match; the "wait your turn" complaint
   may be partly inherent to one shared device and partly these timings. Phase 0
   may move it on its own.
8. A load test that simulates the morning punch rush — concurrent punches from
   ~100 employees. That is the real workload and nothing currently exercises it.

### Phase 3 — structural, only if Phase 2 justifies it
9. Lazy-load the six remaining eager fetches on `/wfm/me` (R3).
10. Server-side pagination wherever a list fetches everything then slices (R1).
11. Day-facts materialisation — only against the R6 trigger.

### Phase 4 — correctness work already queued
12. **KAN-28**: approve resolves the supersede chain to its live head; approve
    becomes claim-then-act so two approvals cannot both write; repair the 14
    affected employee-days.
13. Audit leftovers: unbounded correction `target_date`, no dedup, no withdraw.

---

## 4. How we will know it worked

- **Fluid usage** back to the 5–8 GB-Hrs/day baseline and staying there.
- **No OOM kills** in BIM's 07:00–13:00 UTC punch window.
- **The load test passes** at 10× BIM's headcount inside the R5 budget.

The first two are already observable; the third is Phase 2's deliverable and is
the only one that tells us anything *before* a client does.
