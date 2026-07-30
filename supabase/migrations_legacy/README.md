# Legacy migrations (0001–0029)

These predate the multi-tenant rebuild and/or are already folded into
`supabase/migrations/0000_baseline.sql` (a snapshot of `schema.sql` as of
2026-07-19). They are **already applied on the production database** and are
kept here for historical reference only.

Do NOT apply these to a new database — a fresh environment is built from
`supabase/migrations/` alone: `0000_baseline.sql` first, then `0030+` in
filename order. That directory is what Supabase's GitHub integration applies
automatically for the staging project (see RELEASE_PROCESS.md).

Note: `0001_init.sql` here is the original *single-tenant* schema — it cannot
be combined with the baseline (duplicate tables, no `tenants` FK) and exists
purely as history.
