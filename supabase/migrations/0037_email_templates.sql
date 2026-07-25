-- Email templates: subject + body pairs a tenant can pick between when sending
-- an email (quote today; category exists so invoice/report templates can be
-- added later without another schema change). Distinct from text_fragments
-- (Settings -> Templates), which are single-field snippets inserted into a
-- quote's own content, not a subject+body pair with send-time substitution.
create table email_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  category    text not null default 'quote' check (category in ('quote', 'invoice', 'report')),
  name        text not null,
  subject     text not null,
  body        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index email_templates_tenant_category_idx on email_templates (tenant_id, category);

alter table email_templates enable row level security;

create policy "email_templates: tenant isolation" on email_templates for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
