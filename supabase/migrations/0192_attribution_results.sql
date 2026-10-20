-- 0192: the computed answer, one row per asset per model (docs/shells/attribution-shell.md).
-- "Revenue by campaign" reads this table; the cron rewrites it from marketing_touches, opportunities and
-- invoices. A row is replaced in place (unique key below) and rows from an earlier run that no longer
-- apply are deleted, so a recompute is idempotent: running it twice leaves the same rows.
--
--   model   first | last | linear           how credit for STARTING a deal is shared among the touches before it
--   mode    engaged | all                   whether a touch counts only when the person did something
--   sourced_*      share of the deals this asset STARTED (touches before the deal was created); sums to
--                  one deal per deal, so these can be added up
--   influenced_*   deals this asset TOUCHED at any point in the window; a deal appears under every asset
--                  that touched it, so these must NOT be added up
--
-- RLS: SELECT-ONLY for members (a revenue claim per campaign); the cron writes on the service-role client.

create table if not exists attribution_results (
  tenant_id               uuid not null references tenants(id) on delete cascade,
  model                   text not null check (model in ('first', 'last', 'linear')),
  mode                    text not null check (mode in ('engaged', 'all')),
  asset_type              text not null check (asset_type in ('campaign', 'newsletter', 'form', 'journey', 'whatsapp', 'event')),
  asset_id                uuid not null,
  window_days             int not null default 90,
  touches                 int not null default 0,
  people                  int not null default 0,
  sourced_deals           numeric(12,3) not null default 0,
  sourced_open_value      numeric(16,2) not null default 0,
  sourced_won_deals       numeric(12,3) not null default 0,
  sourced_won_value       numeric(16,2) not null default 0,
  sourced_paid_value      numeric(16,2) not null default 0,
  influenced_deals        int not null default 0,
  influenced_won_deals    int not null default 0,
  influenced_won_value    numeric(16,2) not null default 0,
  computed_at             timestamptz not null default now(),
  primary key (tenant_id, model, mode, asset_type, asset_id)
);

create index if not exists attribution_results_view_idx on attribution_results (tenant_id, asset_type, model, mode);

alter table attribution_results enable row level security;
drop policy if exists "attribution_results: tenant read" on attribution_results;
create policy "attribution_results: tenant read" on attribution_results for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No insert/update/delete policy on purpose.
