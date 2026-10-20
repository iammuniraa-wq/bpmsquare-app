-- 0185: WhatsApp templates (docs/marketing-platform-architecture.md section 7, docs/shells/whatsapp-shell.md).
-- A template is the pre-approved message WhatsApp lets a business start a conversation with. The
-- body names its variables in plain words ({{contact_name}}, {{quote_ref}}); the provider adapter
-- maps them to the provider's positional form at send time.
--
-- `status` is the approval state. In the shell it is set BY A PERSON (there is no provider to ask),
-- so a send is allowed only for 'approved'. Because that flag is a trust claim (it decides what may
-- be sent to customers), RLS is SELECT-ONLY for members: every write goes through
-- /api/whatsapp/templates with the service-role client after requireTenantUser(), with the tenant on
-- every query. Same convention as journeys (0165) and the WFM tables in MULTI_TENANT_GUARDRAILS.md.
--
-- Pending-migration behaviour: every screen reads 42P01 / 42703 / PGRST205 as "nothing there yet".

create table if not exists whatsapp_templates (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  ref                     text,                          -- WAT-0001, MASTER_REF_TABLES
  name                    text not null,                 -- what your team calls it
  language                text not null default 'en',    -- ISO 639-1
  category                text not null default 'marketing' check (category in ('marketing', 'utility', 'authentication')),
  body                    text not null,                 -- with {{variable}} placeholders from a fixed list
  -- The name registered at the provider, once a real provider exists.
  provider_template_name  text,
  status                  text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  rejection_reason        text,
  approved_at             timestamptz,
  -- The consent topic the send is checked against (a key from config.marketing.topics); null = any.
  topic                   text,
  custom_data             jsonb,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists whatsapp_templates_tenant_idx on whatsapp_templates (tenant_id, status, updated_at desc);
create unique index if not exists whatsapp_templates_tenant_ref_uniq on whatsapp_templates (tenant_id, ref) where ref is not null;
-- One template per name and language in a workspace.
create unique index if not exists whatsapp_templates_tenant_name_lang_uniq on whatsapp_templates (tenant_id, lower(name), language) where status <> 'archived';

alter table whatsapp_templates enable row level security;
drop policy if exists "whatsapp_templates: tenant read" on whatsapp_templates;
create policy "whatsapp_templates: tenant read" on whatsapp_templates for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No insert/update/delete policy on purpose.
