-- 0220_tender_deals.sql
--
-- GCC tender deals, slice 1 (docs/design/gcc-tender-deals.md section 3). A tender is an ordinary deal (opportunities) plus ONE
-- row in opportunity_tenders: no column is added to opportunities, so a workspace without the platform-admin flag `gcc_tender`
-- never reads or writes any of this and every standard deal behaves exactly as before. Needs 0120 (opportunities).
--
-- 1. deal_types: the workspace's deal types as data. One row per workspace with code 'tender' is made by the app on the first
--    tender (idempotent). Slice 1 reads the stage list from code; the column is there for the day a workspace edits it.
-- 2. opportunity_tenders (1:1 on opportunity_id): tender number, issuer, portal, closing date, bid bond, addenda count, the
--    recorded bid / no-bid decision (who and when), the source e-mail, custom data, and the closing-date reminders already sent.
-- 3. The Inbox can create a deal (Create from this email > Deal): the four CHECK lists that name the types a channel may
--    prefer and a converted e-mail may link to are widened by 'deal' / 'opportunities'. Each guarded: runs only where the
--    Inbox tables exist (0214), adds values and removes none of the existing ones.
-- 4. email_log.kind gains 'tender' for the closing-date reminders (same in-place widening 0214 used for 'inbox').
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; same lesson as 0199 and the WFM tables): both new tables carry a tenant SELECT policy and
-- NOTHING that writes. A member must not be able to forge a "go" decision under someone else's name, rewrite who decided and
-- when, or clear the reminders through PostgREST with their own session token, so every write goes through a service-role
-- API route that has already checked the tenant, the foreign ids and the caller.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the Tenders tab says a database update is needed
-- and creating a tender answers 503; nothing else changes and nothing crashes (42P01 / PGRST205 are read as "not there yet").

create table if not exists deal_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  stages      jsonb not null default '[]',
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table deal_types enable row level security;

drop policy if exists "deal_types: tenant read" on deal_types;
create policy "deal_types: tenant read" on deal_types for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists opportunity_tenders (
  opportunity_id     uuid primary key references opportunities(id) on delete cascade,
  tenant_id          uuid not null references tenants(id) on delete cascade,
  deal_type_id       uuid references deal_types(id) on delete set null,
  tender_no          text,
  issuer_name        text,
  issuer_account_id  uuid references accounts(id) on delete set null,
  portal             text check (portal in ('ariba', 'email', 'excel', 'other')),
  closing_at         timestamptz,
  bid_bond_amount    numeric(14,2) check (bid_bond_amount is null or bid_bond_amount >= 0),
  bid_bond_currency  text,
  bid_bond_expiry    date,
  addenda_count      int not null default 0 check (addenda_count >= 0),
  decision           text check (decision in ('go', 'no_go')),
  decision_reason    text,
  decided_by         uuid,
  decided_at         timestamptz,
  -- The Inbox message this tender was made from. No foreign key, so this file stands alone without 0214.
  source_email_id    uuid,
  custom_data        jsonb,
  -- The reminder thresholds already sent, as day numbers: [7, 3, 1, 0]. Reset when the closing date changes.
  reminders_sent     jsonb not null default '[]',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists opportunity_tenders_tender_no_uniq
  on opportunity_tenders (tenant_id, tender_no) where tender_no is not null;
create index if not exists opportunity_tenders_closing_idx on opportunity_tenders (tenant_id, closing_at);

alter table opportunity_tenders enable row level security;

drop policy if exists "opportunity_tenders: tenant read" on opportunity_tenders;
create policy "opportunity_tenders: tenant read" on opportunity_tenders for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- The Inbox: 'deal' as a create type and 'opportunities' as a linked object. The existing check on each column is found
-- by what it constrains (its name differs between databases that were set up by hand), dropped, and replaced by the
-- widened list. Runs only where the table exists.
do $$
declare
  spec record;
  con  record;
begin
  for spec in
    select * from (values
      ('inbox_channels',  'default_action',      '''quote'', ''project'', ''case'', ''estimate'', ''lead'', ''deal'', ''none'''),
      ('inbound_emails',  'linked_object_type',  '''standard_quotes'', ''wfm_projects'', ''cases'', ''estimates'', ''leads'', ''opportunities'''),
      ('record_files',    'object_type',         '''standard_quotes'', ''wfm_projects'', ''cases'', ''estimates'', ''leads'', ''opportunities'''),
      ('record_sources',  'object_type',         '''standard_quotes'', ''wfm_projects'', ''cases'', ''estimates'', ''leads'', ''opportunities''')
    ) as v(tbl, col, vals)
  loop
    if to_regclass('public.' || spec.tbl) is null then
      continue;
    end if;
    for con in
      select c.conname from pg_constraint c
      where c.conrelid = ('public.' || spec.tbl)::regclass and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%' || spec.col || '%'
    loop
      execute format('alter table %I drop constraint %I', spec.tbl, con.conname);
    end loop;
    execute format('alter table %I add constraint %I check (%I in (%s))', spec.tbl, spec.tbl || '_' || spec.col || '_check', spec.col, spec.vals);
  end loop;
end $$;

-- The closing-date reminders are recorded in email_log like every other business email. The kind list is widened IN PLACE
-- (the current definition plus 'tender'), so a kind another migration added is never dropped by this one.
do $$
declare
  def text;
  widened text;
begin
  if to_regclass('public.email_log') is null then
    return;
  end if;
  select pg_get_constraintdef(oid) into def
    from pg_constraint where conrelid = 'public.email_log'::regclass and conname = 'email_log_kind_check';
  if def is null or position('''tender''' in def) > 0 then
    return;
  end if;
  widened := regexp_replace(def, '\]\)', ', ''tender''::text])');
  if widened = def then
    raise notice 'email_log_kind_check has an unexpected shape; add ''tender'' to it by hand';
    return;
  end if;
  execute 'alter table email_log drop constraint email_log_kind_check';
  execute 'alter table email_log add constraint email_log_kind_check ' || widened;
end $$;
