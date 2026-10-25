# Dump the production schema (schema only, no data) and compare it with the repo

Why this exists: the repo builds a database from nothing (`node scripts/dedicated/build-fresh-schema.mjs`), and a static
read of that build finds no ordering error. But production has drifted before (migrations are pasted in by hand; see
`docs/dedicated-instance.md` section 5 and `PROJECT.md` ledger), and the static reader cannot see a column or bucket
that was added in the dashboard and never written down. The only way to be sure the repo build equals what runs today
is to dump production's structure and compare. Do it once before the KAMCO instance is built, and again whenever a
migration was run on production without a file.

**Nothing in this procedure reads or writes row data.** It needs a read-only database connection; do not use the
service-role key for it.

## 0. What you need

- The production **database connection string** (Supabase dashboard > Project Settings > Database > Connection string,
  "Session pooler" or "Direct"). Treat it as a password: put it in an environment variable for the session, never in a
  file or a command history you keep.
- Either the **Supabase CLI** (needs Docker only for `supabase start`, not for `db dump`) or **pg_dump 15+** (the
  production server's major version or newer; `select version();` tells you the server's).

```bash
export PROD_DB_URL='postgresql://...'      # paste it; do not save it
mkdir -p dist/dedicated
```

## 1. Dump the structure

Option A: Supabase CLI (leaves out Supabase's own managed schemas by default):

```bash
supabase db dump --db-url "$PROD_DB_URL" -f dist/dedicated/prod-public.raw.sql
```

Option B: pg_dump (same result, no CLI):

```bash
pg_dump "$PROD_DB_URL" --schema-only --no-owner --no-privileges --schema=public \
  -f dist/dedicated/prod-public.raw.sql
```

`--schema-only` is what keeps data out. Open the file and confirm there is no `COPY ... FROM stdin` or `INSERT INTO`
line (`grep -cE '^(COPY|INSERT INTO)' dist/dedicated/prod-public.raw.sql` must print `0`).

## 2. The parts a public-schema dump misses

Storage buckets and the policies on `storage.objects` live in Supabase's `storage` schema. Read them with queries
(structure only):

```bash
psql "$PROD_DB_URL" -At -c "select id, public, file_size_limit from storage.buckets order by id" \
  > dist/dedicated/prod-buckets.txt
psql "$PROD_DB_URL" -At -c "select policyname, cmd, qual, with_check from pg_policies
                            where schemaname='storage' and tablename='objects' order by policyname" \
  > dist/dedicated/prod-storage-policies.txt
psql "$PROD_DB_URL" -At -c "select extname, extversion from pg_extension order by extname" \
  > dist/dedicated/prod-extensions.txt
```

Expected buckets from the repo (9): `company-assets`, `logos`, `wfm`, `quote-attachments`, `order-attachments`,
`inbox-attachments`, `deal-room-files`, `tender-boq-files`, plus **`case-photos`**, which only exists on production
(created by hand; the code uses it in `src/app/api/cases/[id]/photos/route.ts`, no migration creates it; `bootstrap.sql`
creates it for the new instance). Any other bucket in `prod-buckets.txt` is more drift.

## 3. Strip the noise

The dump carries things that differ between any two Supabase projects and are not part of the product schema:

```bash
sed -E \
  -e '/^SET /d' \
  -e '/^SELECT pg_catalog\.set_config/d' \
  -e '/^CREATE EXTENSION/d' \
  -e '/^COMMENT ON EXTENSION/d' \
  -e '/^ALTER .* OWNER TO /d' \
  -e '/^GRANT /d' -e '/^REVOKE /d' \
  -e '/^ALTER DEFAULT PRIVILEGES/d' \
  -e '/^-- Dumped (from|by)/d' -e '/^-- Name: .*; Type: .*; Schema: .*; Owner:/d' \
  dist/dedicated/prod-public.raw.sql \
  | cat -s > dist/dedicated/prod-public.clean.sql
```

(`GRANT`/`REVOKE` are removed on purpose for this comparison: migration 0200 sets column-level grants on `tenants`,
which is checked separately by `src/lib/tenantsColumnGrants.test.ts` and by the last check in `bootstrap.sql`.)

## 4. Verify against the repo

The reliable way is to build the repo schema in a scratch database and dump that the same way.

1. Start an empty Supabase or Postgres to test against. Easiest: the Supabase CLI local stack
   (`supabase init` in a scratch folder outside this repo, then `supabase start`), which provides the `auth` and
   `storage` schemas the migrations rely on. A plain Postgres will fail on `auth.users` and `storage.buckets`.
2. Build and apply the repo schema:

   ```bash
   node scripts/dedicated/build-fresh-schema.mjs
   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -1 -f dist/dedicated/fresh-schema.sql
   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f scripts/dedicated/bootstrap.sql   # edit the e-mail line first
   ```

   `-1` runs the whole file as one transaction: any error rolls everything back, so a failure leaves nothing half-built.
   If this run fails, the error names the exact statement; that is a defect in the repo, fix it with a new migration.
3. Dump the scratch database exactly as in sections 1 and 3, into `dist/dedicated/repo-public.clean.sql`.
4. Compare:

   ```bash
   diff -u dist/dedicated/repo-public.clean.sql dist/dedicated/prod-public.clean.sql > dist/dedicated/schema.diff || true
   ```

   `pg_dump` sorts objects by type and name, so the two files line up. Differences in column order are normal (a
   column added later sits last on production, in `CREATE TABLE` order on a fresh build); judge them by content.
   Alternatively use a schema-diff tool you trust (for example `migra`, a third-party Python tool, or
   `supabase db diff`); this repo does not depend on one.
5. Compare buckets and policies by eye: `diff dist/dedicated/prod-buckets.txt <(psql "$SCRATCH_DB_URL" -At -c "select id, public, file_size_limit from storage.buckets order by id")`.

## 5. What to do with the differences

| The diff shows | Meaning | Action |
|---|---|---|
| Column / table / policy on **production only** | Hand-applied SQL that was never written down. A new instance built from the repo would be missing it. | Write a new migration (the next free number, guarded with `if not exists`, as `0047_schema_drift_reconcile.sql` did), add it to the PROJECT.md ledger, and re-run the build. Do **not** load the production dump as the new instance's schema. |
| Column / table / policy in the **repo only** | A migration was never run on production (pending in the ledger). | Not a repo defect. Note it in the ledger; the new instance gets it by design. |
| A **different definition** of the same object | Production was edited after the migration, or an old version was run. | Decide which is right with the owner, then fix the repo or production. |
| Only owner / extension / privilege lines | Noise. | Ignore. |

## 6. Leads the static reader already found (check these first)

`node scripts/dedicated/build-fresh-schema.mjs` lists columns the code selects that no migration adds. On the repo state
this kit was written against (develop at 7c500f0d):

- `service_cases.created_at` (`src/app/api/cases/[id]/route.ts:19`)
- `work_orders.created_at` (`src/app/api/work-orders/[id]/route.ts:18`)
- `assets.created_at` (`src/lib/account360/server.ts:93`)

The baseline gives `service_cases` only `intake_at` and no `created_at` for these three tables, and no migration adds one.
Check on production:

```sql
select table_name, column_name from information_schema.columns
where table_schema = 'public' and column_name = 'created_at'
  and table_name in ('service_cases', 'work_orders', 'assets');
```

If production has them, add a guarded migration. If it does not, the delete routes silently skip their deletion-log
entry and the Account 360 assets card comes back empty, which is a product defect on the shared instance too.
