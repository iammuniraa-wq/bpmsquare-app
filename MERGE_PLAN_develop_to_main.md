# Merge plan — `develop` → `main`

> Written 2026-08-06. Follows `RELEASE_PROCESS.md`; this is the concrete
> checklist for THIS release, not a replacement for that document.
>
> Scope: 53 commits. WFM (the whole module), Standard Business Roles + bulk
> user onboarding, the read-only AI assistant, per-module subscription flags,
> and a filters/charts/theming pass.

---

## 1. The one thing that can break production

Migration **0067** backfills eleven new feature flags to `true` for every
existing tenant. The application reads a **missing flag as OFF**, so if the
code reaches production before 0067 runs, every existing client — including
Vikas Pioneers — loses Accounts, Contacts, Quotations, Cases, Work orders,
Technicians, Assets, Suppliers, Analytics, Data Workbench and Administration
from their navigation until it does.

**Therefore: run the migrations first, deploy second.** That ordering is not
a preference, it is the release.

Everything else in this release is either behind a flag that is off by
default, or additive.

---

## 2. Risk assessment

| Area | Risk | Why |
|---|---|---|
| WFM | **None for existing clients** | Gated by `wfm`, enabled on the demo tenant only. Vikas never sees it. |
| Standard Business Roles | Low | Gated by the existing `business_roles` flag. Standard roles are provisioned lazily on first page load, so nothing changes until an admin opens the Roles page. |
| Bulk user import | Low | Additive columns on an existing importer. Behaviour change: it no longer sends invite emails. Confirm the client is briefed. |
| AI assistant | Low | Read-only by construction. Requires `ANTHROPIC_API_KEY`; without it, it reports it is unconfigured. |
| Module subscription flags | **High if mis-sequenced** | See §1. Zero risk if 0067 runs first. |
| Filters / charts / tiles | Low | UI-only, but touches shared list pages every client uses. Worth a visual pass in UAT. |
| `computeDayHours` change | Medium (WFM only) | Multi-session days now bill correctly. Any WFM hours reviewed before this fix will read LOWER (and correctly) afterwards. Demo tenant only. |

---

## 3. Pre-merge checklist

- [ ] UAT signed off on staging against the test cases in `docs/*.docx`.
- [ ] Confirm with the client that bulk-added users get **no invitation
      email** and receive a temporary password from their admin instead.
- [ ] Consent wording change (mentions the Ola Maps mapping service) reviewed
      by whoever owns DPDP compliance.
- [ ] `npx tsc --noEmit`, `npx next build`, `npx vitest run` all clean on
      `develop` (they are, as of the last commit).
- [ ] Confirm 0064–0067 have been applied to the **staging** database and the
      module still behaves (0062–0066 are already applied there).

---

## 4. Release steps

### Step 1 — Production database migrations (BEFORE any deploy)

Run in the **production** Supabase SQL editor, in this order. All are
additive; none drop or rewrite existing data.

| # | File | What it does |
|---|---|---|
| 0062 | `0062_wfm_module.sql` | WFM schema, private selfie bucket, demo-only feature flag |
| 0063 | `0063_wfm_rls_narrow_reads.sql` | Narrows presence/correction reads to own-rows-or-supervisor |
| 0064 | `0064_wfm_leave_requests.sql` | Employee leave-request workflow |
| 0065 | `0065_standard_business_roles.sql` | `template_key` + `is_standard` on `business_roles` |
| 0066 | `0066_wfm_geo_address.sql` | Cached reverse-geocoded address on punches |
| 0067 | `0067_module_feature_flags.sql` | **The backfill in §1. Do not skip.** |

Then run `NOTIFY pgrst, 'reload schema';` — PostgREST caches the schema and
new columns are otherwise invisible until it refreshes.

**Verify before proceeding:**

```sql
select name,
       features->>'accounts'   as accounts,
       features->>'quotations' as quotations,
       features->>'wfm'        as wfm
from tenants order by name;
```

Every existing tenant must show `accounts = true` and `quotations = true`.
`wfm` should be true only for the demo tenant.

### Step 2 — Environment variables (production Vercel)

| Variable | Needed for | If missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI assistant (already used by Standard Quote AI) | Assistant reports it is not configured |
| `OLA_MAPS_API_KEY` | Punch address lookup | Falls back to coordinates + map link — no error |
| `CRON_SECRET` | Nightly selfie-retention job | Cron endpoint rejects calls; selfies are never purged |

`OLA_MAPS_API_KEY` and `CRON_SECRET` are **new to production**. Server-side
only — do not prefix with `NEXT_PUBLIC_`.

Also confirm the Vercel cron in `vercel.json` (`/api/wfm/cron/retention`,
daily 20:00 UTC) is registered on the production project.

### Step 3 — Merge and deploy

```
git checkout main
git pull
git merge develop
git push origin main
```

Watch the Vercel build to completion before smoke-testing.

### Step 4 — Post-deploy smoke test (production, ~10 minutes)

- [ ] Log in as a **Vikas** user. Navigation is exactly as before — nothing
      missing. This is the §1 check; if it fails, go to §5 immediately.
- [ ] Open Accounts, Quotations, Cases, Invoices. All load.
- [ ] Settings shows the same tiles as before for that tenant.
- [ ] Log in as a **demo** tenant admin. Workforce appears; My Workforce loads.
- [ ] Administration → Business Roles: eight standard roles appear, grouped.
- [ ] AI assistant opens and answers one count question.
- [ ] Confirm no client-visible feature appeared for a tenant that did not
      have it before.

### Step 5 — Enable per client (deliberate, after smoke test)

Nothing new is on for real clients until you switch it on at
**Admin → Tenants → [client] → Features**. For a Workforce-only client, turn
off the modules they did not buy — that is now a supported configuration.

---

## 5. Rollback

The code and the database roll back differently, and that matters.

**Code:** `git revert -m 1 <merge-commit>` and push. Fast and safe.

**Database:** do **not** roll the migrations back. They are additive; the
previous code ignores the new columns and the extra feature-flag keys
harmlessly. Reverting 0067 in particular would re-create the very outage it
prevents.

**If navigation disappears for a client after deploy** — that is the §1
failure. Do not revert; simply run 0067 (it is idempotent) and reload. That
is faster than a rollback and fixes the actual cause.

---

## 6. Known follow-ups (not blockers)

- Reverse geocoding was never exercised against a live Ola Maps key from the
  development environment; the response parser is deliberately lenient. Check
  one address renders after `OLA_MAPS_API_KEY` is set.
- Change History and Outbound Emails silently truncate at 300 rows with no
  paging — on a busy tenant the row you want may not be shown. Audit-log
  surface, worth fixing soon.
- Pipeline and Partners remain placeholder pages.
- Supabase has no native "must change password at next login" flag, so a
  temporary password from bulk import stays valid until the user changes it.
- WFM has been tested by us on staging only. Real-device testing (Android
  and iOS cameras, GPS accuracy indoors, offline sync on a genuinely poor
  connection) is still outstanding and is the highest-value remaining test.
