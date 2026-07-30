# Release Process & Environments

> Created 2026-07-30, after the decision to stop shipping every commit straight
> to production. Read this before pushing anything.

## Why this exists

Until now every push to `main` deployed immediately to the single production
app — the same deployment Vikas Pioneers (a paying client) uses. QA was
happening in production (the VIK-* Jira bugs were raised against live client
data), and every SQL migration was run directly on the production database.
A "dev tenant" alone cannot fix this: tenants share one codebase, so any
change to shared components (nav, themes, forms, tables) reaches every
tenant the moment it deploys, regardless of which tenant it was built for.
Tenants isolate **data and feature flags**, not **code**.

## The architecture

```
develop branch ──► staging deployment ──► staging Supabase ──► Dev tenant (experiments)
      │
      │  merge when QA-approved
      ▼
main branch ─────► production deployment ─► production Supabase ─► Demo tenant (showcase)
                                                                 └► Vikas + future clients
```

| | Staging | Production |
|---|---|---|
| Git branch | `develop` | `main` |
| Deployment | Vercel preview of `develop` (optionally pinned to `staging.bpmsquare.com`) | The existing production Vercel project |
| Database | **Separate** staging Supabase project | The existing production Supabase |
| Tenants | `dev` tenant — throwaway data, drastic experiments | `demo` (client-facing showcase) + real clients |
| Who sees it | Us + QA | Clients |

## The flow

1. **All new work lands on `develop`** — features, refactors, drastic ideas.
2. **Migrations run on the staging Supabase first**, at the time the feature
   lands on `develop`. The migration file in `supabase/migrations/` is the
   record; production gets the same file later, at promotion time.
3. **QA tests on staging** against the Dev tenant. Bugs are cheap here.
4. **Promote**: merge `develop` → `main` (fast-forward or merge commit),
   run any pending migrations on production Supabase, verify the production
   deploy, then smoke-test the Demo tenant.
5. **Per-tenant rollout** stays what it is today: feature flags
   (`tenants.features`) and config (`tenants.config`, e.g. `ui_theme`) decide
   which finished features each client sees. Flags are for *gradual rollout
   of finished work*; staging is for *unfinished work*. Not interchangeable.

**Hotfixes** (production is broken for a client): branch from `main`, fix,
push to `main` directly, then merge `main` back into `develop` so the fix
isn't lost at the next promotion.

## Migration discipline

- Every schema change is a tracked file in `supabase/migrations/` — never
  ad-hoc SQL in a dashboard (see MULTI_TENANT_GUARDRAILS.md).
- A migration is applied to staging when its feature lands on `develop`.
- Keep a "pending on production" list: at promotion time, every migration
  file added since the last promotion is run on production, in order,
  **before** the `main` deploy goes live.
- RLS policies ship in the same migration as the table they protect. No
  exceptions (guardrails rule).

## One-time setup checklist (human, in dashboards)

Code side (done by Claude): `develop` branch created from `main`; this
document committed to both branches.

- [ ] **Supabase**: create a second project (e.g. `bpmsquare-staging`, free
      tier). Run `supabase/schema.sql` + every file in `supabase/migrations/`
      in order against it (SQL editor, or `supabase db push` if using the CLI).
- [ ] **Supabase staging**: create the `dev` tenant row + a login user for
      yourself (mirror how the demo tenant was seeded), or export/import the
      demo tenant's data via the admin export for realistic test data.
- [ ] **Vercel**: in the BPMSquare project → Settings → Environment
      Variables, add the staging Supabase URL / anon key / service-role key /
      `FIELD_ENCRYPTION_KEY` etc. scoped to the **Preview** environment
      (Production keeps the current values). Every push to `develop` then
      gets a preview URL wired to the staging DB automatically.
- [ ] **Optional**: Vercel → Domains → assign `staging.bpmsquare.com` to the
      `develop` branch for a stable staging URL (host-based tenant resolution
      needs the staging tenant's `custom_domain` to match whatever host you use).
- [ ] Confirm the staging deployment can log in and sees the `dev` tenant.

## State snapshot at the time this process was adopted (2026-07-30)

For orientation — what was already live on production when this split began:

- **Themes**: `tenants.config.appearance.ui_theme` = `classic` | `modern`
  (navy Structured-Enterprise) | `modern2` (Salesforce-style solid blue —
  the preferred direction) | `modern3` (Microsoft Fluent light grey).
  Modern 1 is the default for newly created tenants; existing tenants
  resolve to classic unless set. Platform-admin-only toggle in
  `/admin/tenants/[id]`. Chrome (sidebar/tab bar/search), dashboard tiles,
  quick-create, quotes list, Adapt drawers are all theme-tokenized
  (`--sb-*`, `--card-*`, `--drawer-*`, `--modern-*` in `globals.css`).
- **Nav**: grouped into expandable parents — Sales / Service / Marketing /
  Master data, with Dashboard/Accounts/Contacts + Analytics/Data Workbench
  top-level.
- **Recent fixes**: ref generation for quotes/invoices/POs/cases is
  max-existing+1 with a free-ref probe (`src/lib/refSeq.ts`) — the
  count-based duplicate-key bug (VIK-5) is closed. Quotes list exposes all
  standard + custom fields as columns with the Adapt drawer on the toolbar.
  Mobile top bar / global search overlay fixed.
- **Marketing suite**: campaigns, festival templates, segmentation builder,
  target groups, leads with campaign attribution, global search — all live,
  feature-flag-gated per tenant.
- **Known debt**: see `MULTI_TENANT_GUARDRAILS.md` tracked-debt section;
  QA test-case sheets exist for marketing + global search.
