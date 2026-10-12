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

---

## Runbook addendum — Work from home / Site visit (KAN-29 part 2)

> **WITHDRAWN FROM THE SCREEN, 2026-10-11 (same day).** The owner asked for one
> phone choice instead of three: "instead of these 3 I need one, phone punch +
> kiosk." The Punching dropdown now reads **Workspace default / Kiosk only /
> Phone punch + kiosk**. The rest of this section describes what the server
> still supports -- `employees.remote_mode`, migration 0127 (run), the narrowed
> punch gate and the six-button punch screen -- all dormant, because nothing in
> the UI sets a mode any more. Someone already saved with a mode keeps it, and
> keeps an "(existing)" entry in the dropdown so editing them does not widen
> their access. Re-exposing it is a few lines in `WfmEmployeesClient.tsx`.
> "Phone punch + kiosk" is the old "Allow from phone": every punch, from the
> phone or the kiosk.

Written 2026-10-11. Extends the runbook above; do that one first.

Migration: `supabase/migrations/0127_wfm_employee_remote_mode.sql`, run AFTER
0126. Same safety property as 0126: until it runs the code reads the new
column as "no mode" and behaves exactly as before, so deploying first is safe.

What it changes for a person a supervisor has allowed to punch from their
phone: instead of "allowed, any punch" the supervisor now picks **Work from
home**, **Site visit** or **Work from home + Site visit**. Their phone then
offers only those punches, plus breaks and overtime, and **no plain check in
or check out** -- so every remote day is labelled as one. A standing Work from
home choice also **replaces the per-day work-from-home request**, so the
supervisor does not approve the same person twice.

**Do these in this order:**

1. Push and promote (verify the Production badge, as always).
2. Run migration 0127.
3. **Switch on the workspace types.** Settings → Workforce → Work from home
   and Site visit. They default OFF and are NOT on for BIM unless someone
   switched them. Saving a remote mode whose switch is off is refused with a
   message naming the switch -- but only after the supervisor has tried.
4. Then, on each remote person: WFM → Employees → Edit → **Punching**.

**What to check:**

- A person set to Work from home sees `Work from home start / end` and the
  break buttons, and no `Check in`. Set to Both, they see six buttons.
- **A direct `POST /api/wfm/punch` with `kind: "check_in"` for that person
  returns 403** and a message saying their phone is set up for Work from home.
  The missing button is not the test.
- With Work from home set, `mobile_work_start` works with NO request filed for
  the day. Without a mode it still needs one.
- Someone already allowed from their phone under 0126 keeps every punch until a
  supervisor changes them; the list shows them as "Phone punch".

**Known limits, deliberate:**

- A remote person cannot close a session opened at the kiosk from their phone:
  plain check out is withheld. They check out at the kiosk or ask a supervisor
  to correct it. If that bites in practice, allowing check out for remote
  modes is a one-line change in `lib/wfm/selfService.ts`.
- Overtime stays available from the phone for remote people (it is approved
  afterwards, and says nothing about where they are).
- The mode is permanent until a supervisor changes it, like the override.

---

## Runbook addendum — supervisor time correction

Written 2026-10-11. No migration. A supervisor opens an employee, Attendance
tab, **Correct** on a day, and changes a punch or adds a missing one with a
mandatory reason. The employee is emailed (the existing "Correction decided"
switch) and sees what changed and why in their own Corrections list.

- Limit: this month and the previous one, in the workspace's timezone
  (`SUPERVISOR_EDIT_MONTHS` in `lib/wfm/timeCorrection.ts`).
- Nobody changes their own time.
- First real use is the test -- the endpoint has no automated test because it
  needs a database. Change one punch for a test employee and check three
  places: the employee's Corrections tab, Administration → Change history, and
  the email.

---

## Runbook addendum — kiosk-only blocks PUNCHING, not sign-in

Rewritten 2026-10-12. No migration. The sign-in block shipped 2026-10-11 was
reverted the next morning: BIM meant "no punching from the phone", not "no
access". With the workspace on kiosk-only, an employee without "Phone punch +
kiosk" signs in normally and sees their hours, timesheet, leave and correction
requests. On the Punch tile they see "Punch in and out at the office kiosk" in
place of the buttons.

**The real gate is the server:** `POST /api/wfm/punch` returns 403 for a
kiosk-only employee, so no tampered client can punch. The kiosk is unaffected.
The per-employee "Punching" dropdown on the Employees page still decides who has
phone access; "Workspace default" follows Settings → Workforce.

The earlier `blocksLogin` rule, the layout redirect and the `error=kiosk_only`
login handling were removed from the layout and rule file; the login page still
recognises the old `?error=kiosk_only` link and just shows the message.

**To test:** sign in as a plain employee with no exception: expect the app, the
kiosk message where the punch buttons were, and a 403 if you try to punch. Then
one with Phone punch + kiosk: expect the buttons.
