-- 0106: push notifications to an employee's own phone, and the long-day alert
-- that is the first thing to use them.
--
-- Client request (BIM, 2026-09-04): tell an employee directly, on their
-- mobile, once they have worked past a threshold, so they know to punch out.
--
-- It has to be push rather than email: employees sign in by employee code and
-- their Supabase account carries a SYNTHETIC address at
-- employee.bpmsquare.local (see lib/wfm/employeeLogin.ts), a reserved domain
-- that can never receive mail. The product's existing notification channel
-- physically cannot reach these people.

-- One row per browser/device an employee has allowed notifications on. A
-- person may have several (phone plus tablet), and every one gets the alert.
create table if not exists wfm_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  -- The push service URL the browser gave us. Unique across the table: the
  -- same endpoint is the same device, so re-subscribing updates rather than
  -- accumulating dead rows.
  endpoint     text not null unique,
  -- Public key + auth secret from the browser's subscription, needed to
  -- encrypt each payload. Useless without the server's VAPID private key.
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);

create index if not exists wfm_push_subscriptions_emp_idx
  on wfm_push_subscriptions (tenant_id, employee_id);

alter table wfm_push_subscriptions enable row level security;

-- NO policies at all, deliberately -- same reasoning as wfm_kiosk_devices
-- (0092): these rows are device credentials. Every read and write goes
-- through an API route on the service-role client.

-- Which employees have already been told today, so a job that runs every
-- fifteen minutes does not buzz someone's phone every fifteen minutes.
-- Keyed per shift-day, not per calendar day, so a night shift is one alert.
create table if not exists wfm_hours_alerts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  day_key     date not null,
  worked_minutes integer not null,
  sent_at     timestamptz not null default now(),
  unique (tenant_id, employee_id, day_key)
);

create index if not exists wfm_hours_alerts_day_idx
  on wfm_hours_alerts (tenant_id, day_key);

alter table wfm_hours_alerts enable row level security;
-- WFM convention (0062): tenant-scoped SELECT only, no write policy -- the
-- cron writes these through the service-role client.
drop policy if exists "wfm_hours_alerts: tenant read" on wfm_hours_alerts;
create policy "wfm_hours_alerts: tenant read" on wfm_hours_alerts for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
