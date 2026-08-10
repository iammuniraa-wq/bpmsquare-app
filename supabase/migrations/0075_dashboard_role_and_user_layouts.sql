-- Role-based + personal dashboard layouts.
--
-- business_roles.dashboard_layout: an admin-designed default dashboard for
-- everyone holding that Business Role (same DashLayoutItem[] shape already
-- used by tenants.config.dashboard_layout). Null = this role doesn't define
-- one; a member whose assigned roles all leave this null keeps seeing the
-- tenant-wide default, unchanged from today.
--
-- tenant_users.dashboard_layout_override: a user's own personal tweaks on
-- top of whichever default (role-derived or tenant-wide) would otherwise
-- apply to them. Null = no personal override, use the default. Self-service,
-- never admin-gated -- it only ever affects the one row it belongs to.
--
-- Both additive and nullable; no existing dashboard changes until an admin
-- or user explicitly sets one.

alter table business_roles add column if not exists dashboard_layout jsonb;
alter table tenant_users add column if not exists dashboard_layout_override jsonb;
