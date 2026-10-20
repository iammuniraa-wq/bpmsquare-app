-- 0171: form_submissions (docs/marketing-platform-architecture.md 5.1).
-- The raw answers of each submit, kept 180 days (expires_at), after which only the
-- records derived from them (contact, account, lead, consent rows) remain.
-- Personal answers (name, email, phone, company, message, custom answers) are
-- encrypted with src/lib/encryption.ts exactly like contacts; ip_hash is a keyed
-- hash, never an address.
--
-- RLS: SELECT-ONLY for members, no write policy at all. A submission is evidence
-- (it sits behind consent rows and a lead); it is written only by the public submit
-- route with the service-role client, after the checks. Requires 0170.

create table if not exists form_submissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  form_id       uuid not null references forms(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete set null,
  account_id    uuid references accounts(id) on delete set null,
  lead_id       uuid references leads(id) on delete set null,
  -- { name, company, email, phone, message, custom1..3 } -- each value encrypted
  answers       jsonb not null default '{}'::jsonb,
  consent_given boolean not null default false,
  -- 'created' = a new contact was made, 'matched' = an existing one was found by email
  outcome       text not null default 'created' check (outcome in ('created', 'matched')),
  ip_hash       text,
  ua_family     text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '180 days')
);

create index if not exists form_submissions_form_idx on form_submissions (tenant_id, form_id, created_at desc);
create index if not exists form_submissions_ip_idx on form_submissions (tenant_id, ip_hash, created_at desc) where ip_hash is not null;
create index if not exists form_submissions_expiry_idx on form_submissions (tenant_id, expires_at);

alter table form_submissions enable row level security;
drop policy if exists "form_submissions: tenant read" on form_submissions;
create policy "form_submissions: tenant read" on form_submissions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
