-- 0170: Forms (docs/marketing-platform-architecture.md 5.1, phase M4 shell).
-- A form is a small configuration document: a few fixed fields, an exact consent
-- text and the topics it covers, and what happens after a submit. It is shown on
-- the tenant's own domain at /f/<slug> and embedded on the client's website by an
-- iframe. public_key is the credential the public submit route resolves the tenant
-- from; the tenant id is never taken from a request.
--
-- RLS: the standard tenant-isolation policy. A form is marketing content that an
-- admin edits through the app; nothing here is something a member has an incentive
-- to forge (compare WFM, where the stricter select-only convention applies).
-- Submissions and consent are a different matter and are select-only (0171).
--
-- Pending-migration behaviour: every page and route reads 42P01 / 42703 / PGRST204 /
-- PGRST205 as "waiting for the database update", never a crash. The public routes
-- answer 404.

create table if not exists forms (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  ref           text,                                   -- FRM-0001, MASTER_REF_TABLES
  name          text not null,                          -- only the team sees it
  slug          text not null,                          -- /f/<slug> on the tenant's own domain
  public_key    text not null,                          -- the public submit credential; not a tenant id
  status        text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  title         text,                                   -- heading shown on the form
  intro         text,                                   -- one short paragraph under it
  button_label  text,
  -- [{ key: name|company|email|phone|message|custom1..3, label, required, enabled }]
  fields        jsonb not null default '[]'::jsonb,
  -- { text, topics: [topic keys], required }  -- text is stored in the consent evidence verbatim
  consent       jsonb not null default '{}'::jsonb,
  -- { kind: 'message'|'redirect', message, redirect_url }
  after_submit  jsonb not null default '{}'::jsonb,
  custom_data   jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists forms_public_key_uniq on forms (public_key);
create unique index if not exists forms_tenant_slug_uniq on forms (tenant_id, slug);
create unique index if not exists forms_tenant_ref_uniq on forms (tenant_id, ref) where ref is not null;
create index if not exists forms_tenant_idx on forms (tenant_id, updated_at desc);

alter table forms enable row level security;
drop policy if exists "forms: tenant isolation" on forms;
create policy "forms: tenant isolation" on forms for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
