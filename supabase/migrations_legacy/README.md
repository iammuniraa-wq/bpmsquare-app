# Legacy migrations (0001–0029)

These are **already applied on the production database** and kept for
reference. 0001-0006 predate the multi-tenant rebuild (superseded by the
schema.sql snapshot); 0007-0027 are replayed verbatim inside
`supabase/migrations/0000_baseline.sql`'s addendum (the snapshot alone was
missing their changes); 0028/0029's RLS fixes are already reflected in the
snapshot itself.

Do NOT apply these to a new database — a fresh environment is built from
`supabase/migrations/` alone: `0000_baseline.sql` first, then `0030+` in
filename order. That directory is what Supabase's GitHub integration applies
automatically for the staging project (see RELEASE_PROCESS.md).

Note: `0001_init.sql` here is the original *single-tenant* schema — it cannot
be combined with the baseline (duplicate tables, no `tenants` FK) and exists
purely as history.
