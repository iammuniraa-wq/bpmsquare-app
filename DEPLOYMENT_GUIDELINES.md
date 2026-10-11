# Deployment Guidelines

> Added 2026-09-07, after Build CPU Minutes turned out to be the largest
> line item on the Vercel usage bill — every push to every connected branch
> was triggering a full build, including branches that were mid-work for
> days and commits that only touched `PROJECT.md`. Read this before you push
> to a branch that's new to you, or before you touch
> `scripts/vercel-ignore-build.sh`.

## The rule

Only pushes to **`main`** and **`develop`** trigger a Vercel build. Every
other branch (`fix/*`, `pricing/*`, or any future working branch) is built
locally (`npm run dev`) or reviewed in its PR diff — it does not get its own
rebuilt preview URL on every commit. A push on `main`/`develop` that touches
**only** `*.md` files or `docs/**` also skips the build, since none of that
reaches the deployed app.

This is enforced by [`scripts/vercel-ignore-build.sh`](scripts/vercel-ignore-build.sh),
wired into **Vercel → bpmsquare-app → Settings → Build and Deployment →
Ignored Build Step** as `Run my Bash script` → `scripts/vercel-ignore-build.sh`.

## What this means day to day

- Push to a feature/fix/pricing branch as often as you like — it costs
  nothing until it's merged.
- Push to `develop`/`main` only when the app itself changed. A `PROJECT.md`
  ledger update or a docs tweak on its own is free; bundle it with a real
  code change if you can, rather than pushing it alone.
- **Merging a branch to `develop` or `main` is what should trigger the next
  real build** — that's the deployment that matters.

## If you need a live preview URL for a side branch anyway

Sometimes you genuinely want a shareable preview (e.g. a client demo off a
feature branch) without merging it. Two options, neither requires touching
the Ignored Build Step:

1. **Vercel → Settings → Git → Deploy Hooks** — create a hook bound to that
   branch. Hitting the hook's URL triggers exactly one build, on demand,
   without needing every commit on the branch to build.
2. Temporarily comment out the branch check in
   `scripts/vercel-ignore-build.sh`, push, then revert — only do this if a
   Deploy Hook doesn't fit (e.g. you need it to track every push for a
   short live-review window).

## Editing `scripts/vercel-ignore-build.sh`

- It runs on Vercel's Linux build machine as a real executable, invoked via
  the `Run my Bash script` setting. Two things that will silently break it
  if missed, both already fixed once (2026-09-07):
  - **Line endings must stay LF.** `.gitattributes` pins `*.sh` to `eol=lf`
    so a Windows checkout/recommit doesn't flip it to CRLF, which fails the
    shebang line.
  - **Keep the exec bit.** If you recreate this file (rather than editing
    the existing one) on Windows, git will stage it as `100644` instead of
    `100755` and the build step fails in ~3 seconds with no useful log line.
    Fix with `git update-index --chmod=+x scripts/vercel-ignore-build.sh`
    before committing, or check `git ls-files -s scripts/vercel-ignore-build.sh`
    starts with `100755`.
- Exit code contract (Vercel's, not ours): `0` = skip the build, `1` = build.
  Any *other* exit code is also treated as "build", so a script bug that
  crashes early still builds — safe by default, but worth knowing that a
  crash won't look like a deliberate skip in the logs.

## How to confirm it's working

Open **Deployments** on the Vercel project after a push:
- A push to a side branch, or a docs-only push to `main`/`develop`, should
  show as **Skipped** with no build duration.
- A real code push to `main`/`develop` should build normally and show the
  usual **Ready**/**Error** status.

If a side-branch push still builds, the script isn't wired up (recheck
Settings → Build and Deployment → Ignored Build Step) or the exec bit was
lost again on a recent edit.

---

## Instant Rollback pins production — it does not auto-resume

Added 2026-10-03, after this cost most of a night.

A Vercel **Instant Rollback** does exactly what it says: it points production
at an older deployment and **keeps it there**. Subsequent pushes still build,
still go green, and still say "Ready" — but they are **not promoted**. In the
Deployments list the live one carries a blue badge with a **↺ rollback icon**;
the newer ones show a Production badge with a **⏱ clock**, which means built
and queued, not serving.

During the 2026-09-23 incident three successive fixes were deployed, tested
and declared not to work, because production was still serving yesterday's
code the whole time. Hours went into re-diagnosing a bug that was already
fixed.

**After any rollback, before concluding that a fix did not work:** open
Deployments and confirm the Production badge sits on the newest deployment.
If it does not, promote it explicitly (**⋯ → Promote to Production**).

A fast way to tell from outside: pick something the new deployment changes
that is visible without logging in, and check it. Note that an authenticated
API route is a poor test — middleware redirects an unauthenticated request to
`/login` before the route resolves, so a deleted route still answers 307 and
proves nothing.

---

## Runbook — turning on kiosk-only punching (KAN-29)

Written 2026-10-07 for the BIM change. The ORDER matters; steps 3 and 4 are
not interchangeable.

Code: `b0180eb` + `e61411c`. Migration:
`supabase/migrations/0126_wfm_employee_self_service_override.sql`.

1. **Push and promote.** Verify the Production badge per the section above.
   Safe on its own: with the column absent the flag reads as `null`, so
   behaviour is identical to today and nothing is turned on yet.
2. **Run migration 0126 on both databases.** Still nothing visible — it adds
   a nullable column everyone inherits from.
3. **Grant the exceptions.** WFM → Employees → *Punching: Allow from phone*
   for everyone who genuinely works remotely or visits client sites.
   Supervisors can set this, not only tenant admins.
4. **Flip the workspace.** Settings → Workforce → employee self-service
   **off**. This is the moment the rule takes effect.

   **3 before 4.** Reversed, everyone not yet flagged is locked out of phone
   punching until you have worked through the whole list — and anyone out at
   a client site that morning loses the day to a correction.

5. **Test, in this order:**
   - a normal employee sees "punch in and out at the office kiosk", no buttons
   - **a direct `POST /api/wfm/punch` by that employee returns 403** — the
     hidden button is not the test, this is
   - an employee flagged in step 3 can still punch from their phone
   - the kiosk itself is unaffected throughout

**Pick a quiet day.** Step 4 is a one-way door until someone is flagged: the
moment it lands, anybody not on the list cannot record attendance from their
phone.

**To reverse:** turn employee self-service back on. The per-employee flags
stay as they are and take effect again when it is next turned off.
