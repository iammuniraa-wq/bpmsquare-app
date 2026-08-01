-- 0054_standard_quote_templates.sql
-- Multiple, branded PDF/print templates for Standard Quotes specifically --
-- scoped to standard_quotes only, per user request. Each template is an
-- ordered list of toggleable "blocks" (letterhead, quote meta, bill-to, line
-- items, totals are structural/required; intro text, notes, terms, signature,
-- footer text are optional) plus an accent color and logo position, so a
-- tenant can build several distinct branded layouts without a full
-- drag-and-drop HTML canvas.

create table standard_quote_templates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  name           text not null,
  is_default     boolean not null default false,
  accent_color   text,
  logo_position  text not null default 'left' check (logo_position in ('left', 'center', 'right')),
  blocks         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, name)
);

create index standard_quote_templates_tenant_idx on standard_quote_templates (tenant_id);

alter table standard_quote_templates enable row level security;

create policy "standard_quote_templates: tenant isolation" on standard_quote_templates for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table standard_quotes
  add column template_id uuid references standard_quote_templates(id) on delete set null;
