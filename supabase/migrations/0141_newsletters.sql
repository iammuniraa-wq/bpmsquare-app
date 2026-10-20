-- 0141: Newsletter Studio, tables (docs/newsletter-studio-architecture.md section 3).
-- One standard object, three faces: a newsletter (a design being worked on), a
-- template (is_template = true, a design kept to start from) and an immutable
-- version (a snapshot taken when a newsletter is used in a campaign).
--
-- A newsletter is a STRUCTURED design, never HTML: an ordered list of typed
-- blocks plus, per language, the words. Nothing a person types is stored as
-- markup; the one renderer (src/lib/newsletter/render.ts) makes the HTML.
--
-- RLS
--   newsletters, newsletter_languages: the standard tenant-isolation policy
--     (marketing content, nothing a member has an incentive to forge).
--   newsletter_versions: SELECT-ONLY for members. A version is what a sent
--     campaign points at; it must not be editable through PostgREST with a
--     member's own session (the WFM lesson in MULTI_TENANT_GUARDRAILS.md: check
--     what the data is for before adding the standard `for all` policy). The app
--     writes versions with the service-role client after the checks.
--
-- Independent of 0142 (campaign columns, link clicks) and 0143 (preferred
-- language): the studio degrades without any of them. The seed
-- scripts/seed-newsletter-studio-demo.sql runs AFTER this file.
--
-- Pending-migration behaviour: every route and page reads 42P01 / 42703 /
-- PGRST205 as "waiting for the database update", never a crash.

create table if not exists newsletters (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  ref                 text,                                  -- NWS-0001, MASTER_REF_TABLES
  name                text not null,
  is_template         boolean not null default false,
  -- Fixed list (owner decision 2026-10-19): Newsletter, Offer, Event, Announcement, Festival.
  category            text not null default 'Newsletter'
    check (category in ('Newsletter', 'Offer', 'Event', 'Announcement', 'Festival')),
  status              text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  -- English for every new newsletter; other languages are added on top.
  source_language     text not null default 'en',
  -- A key from config.marketing.topics: what consent is checked against at send.
  topic               text,
  -- [{ id, type, visible, locked, settings }] -- a closed set of block types.
  blocks              jsonb not null default '[]'::jsonb,
  -- The kit as it was when the design was made; a kit change re-brands on next save.
  brand_kit           jsonb,
  built_in_origin     text,                                  -- the built-in design id it was copied from
  template_origin_id  uuid references newsletters(id) on delete set null,
  custom_data         jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists newsletters_tenant_idx on newsletters (tenant_id, is_template, updated_at desc);
create unique index if not exists newsletters_tenant_ref_uniq on newsletters (tenant_id, ref) where ref is not null;

alter table newsletters enable row level security;
drop policy if exists "newsletters: tenant isolation" on newsletters;
create policy "newsletters: tenant isolation" on newsletters for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── One row per language ───────────────────────────────────────────────────
create table if not exists newsletter_languages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  newsletter_id  uuid not null references newsletters(id) on delete cascade,
  lang           text not null,                              -- ISO 639-1: en, ar, hi, ur, fr
  dir            text not null default 'ltr' check (dir in ('ltr', 'rtl')),
  subject        text not null default '',
  preheader      text not null default '',
  -- block_id -> { field -> string }. Paragraph fields hold the tiptap subset
  -- and go through sanitizeRichText on write.
  texts          jsonb not null default '{}'::jsonb,
  -- block_id -> 'written' | 'translated' | 'reviewed'
  review         jsonb not null default '{}'::jsonb,
  status         text not null default 'draft' check (status in ('draft', 'ready')),
  translated_by  text check (translated_by in ('person', 'ai')),
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (newsletter_id, lang)
);

create index if not exists newsletter_languages_tenant_idx on newsletter_languages (tenant_id, newsletter_id);

alter table newsletter_languages enable row level security;
drop policy if exists "newsletter_languages: tenant isolation" on newsletter_languages;
create policy "newsletter_languages: tenant isolation" on newsletter_languages for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Immutable versions ─────────────────────────────────────────────────────
create table if not exists newsletter_versions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  newsletter_id  uuid not null references newsletters(id) on delete cascade,
  version        int not null,
  -- blocks + every language row, as they were.
  snapshot       jsonb not null,
  -- lang -> rendered HTML with the merge tokens still in place.
  html           jsonb not null default '{}'::jsonb,
  -- lang -> plain text.
  text           jsonb not null default '{}'::jsonb,
  -- Every outbound URL in the design, in order. The click-tracking link carries
  -- an INDEX into this list, never a URL, so there is nothing to redirect to
  -- that was not in the design.
  links          jsonb not null default '[]'::jsonb,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (newsletter_id, version)
);

create index if not exists newsletter_versions_tenant_idx on newsletter_versions (tenant_id, newsletter_id, version desc);

alter table newsletter_versions enable row level security;
drop policy if exists "newsletter_versions: tenant read" on newsletter_versions;
create policy "newsletter_versions: tenant read" on newsletter_versions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
