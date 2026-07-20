-- Designate the demo/sandbox tenant explicitly.
--
-- app.bpmsquare.com (PRIMARY_HOST) now resolves to THE demo tenant for every
-- request, and only invited members of it (or platform admins) may enter.
-- An explicit is_demo flag identifies that tenant unambiguously -- rather than
-- inferring it from "the tenant whose custom_domain is null", which would
-- break the moment a real tenant is ever created without a custom_domain.
-- DB-driven (like custom_domain / platform_admins) so the demo tenant can be
-- reassigned without a code deploy, and no UUID is hardcoded in application logic.

alter table tenants add column if not exists is_demo boolean not null default false;

-- The existing "BPMSquare Demo" tenant (slug 'vikas').
update tenants set is_demo = true where id = '32d20e05-3ba5-4e26-8d3c-5741bfe7d6f4';
