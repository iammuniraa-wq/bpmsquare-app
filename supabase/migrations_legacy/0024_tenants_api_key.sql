-- Migration 0024: per-tenant API key for the external /api/v1 surface.
-- The legacy v1 routes (accounts/cases/quotations) only ever checked one process-wide
-- VEVEY_API_KEY boolean against seed data -- there was no real tenant resolution to reuse.
-- Genuinely tenant-scoped live routes (inventory, purchase-orders) need this instead.

alter table tenants add column if not exists api_key text unique;
