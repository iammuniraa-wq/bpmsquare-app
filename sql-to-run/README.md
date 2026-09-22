# SQL to run — 2026-09-22

Everything outstanding from the ten items shipped on 2026-09-21/22, in the
order to run it. Both files are copies kept here for convenience; each one's
canonical home is noted below, because that is what PROJECT.md's ledger and
the migration sequence track.

Nothing here is applied automatically — migrations are pasted into the
Supabase SQL editor by hand (PROJECT.md, "Pushing to `develop` auto-deploys
the **code**… Don't mistake the automatic code deploy for an automatic schema
change").

---

## 1. `1-email-log-kinds.sql` — REQUIRED, both DBs

Canonical: `supabase/migrations/0125_email_log_invoice_rfq_kinds.sql`

Widens the `email_log.kind` CHECK constraint to the six kinds the
application actually writes. **Until this runs, invoice and supplier-RFQ
emails send correctly but leave no log row** — `logEmail()` never throws by
design (a logging failure must not fail a send that may already have gone
out), so the database has been rejecting those two kinds silently since
those senders shipped.

The emails themselves were never affected. The missing rows cannot be
backfilled.

Run on **dev and production**. No downtime, no data change — one constraint
swap.

---

## 2. `2-bim-wfm-landing.sql` — OPTIONAL, production only

Canonical: `scripts/set-wfm-home-landing.sql`

Landing on My Workforce instead of the dashboard is now
`config.wfm.home_landing`, default `dashboard`. That default is the fix: it
used to be a product-wide rule, which is why the demo tenant and every other
workspace was doing it too.

**Only BIM relied on the old behaviour**, so only BIM needs this. Run the
inspection SELECT first, then the UPDATE.

Skip it entirely if you would rather set it in the UI — it is the same
value: Settings → Workforce → "Where a login lands".

Every other tenant, demo included, needs nothing. That is the point.

---

## What does NOT need SQL

- The theme work (rounded outer frame, white nav, header, Spectacular colour
  mixes, Spaces) — CSS and config only.
- The two dashboards — `config.appearance.dashboard_mode`, set in Settings →
  General → Dashboard, defaulting to Curated on Spectacular.
- WFM correction approvals — a code fix; no schema or data change, and
  nothing to re-run over existing corrections.
- Tenant Creation Studio — writes through existing tables only.
