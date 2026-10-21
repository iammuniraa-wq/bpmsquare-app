-- 0202_webhooks_library.sql
--
-- Webhooks library (docs/design/webhooks-library.md): ONE list where every webhook
-- is created and kept. The existing `webhooks` table (0082) gains a `kind`:
--   event  the change feed, drained by the cron (unchanged semantics: cursor,
--          failure_count, auto-pause)
--   call   fired by something -- a Standard Quote awarded, a record button, a
--          Coverage route -- and recorded as a Monitor row each time
-- The ERP push URL (tenants.config.integration_push) and the named Coverage
-- endpoints are imported as Call webhooks, idempotently (legacy_key), nothing lost.
--
-- Access: `webhooks` stays SERVICE ROLE ONLY -- RLS enabled and NO policy, exactly
-- as 0199 left it (a member must never write a row that holds a credential or
-- steers where the server posts: the 0078 / 0199 lesson). This file adds no
-- policy; src/lib/rlsPolicies.test.ts fails the build if one ever appears.
-- `webhook_deliveries` keeps its member read policy. Nothing is added to
-- `tenants`, so the column-grant rule of 0200 does not apply.
--
-- Additive and idempotent; every block is guarded with to_regclass so a database
-- that never had 0082 (webhooks), 0101 (coverages) or 0201 (integration_messages)
-- is simply skipped rather than rolled back. Until it is applied the app shows
-- "database update needed" on the Webhooks page and fires nothing; it never errors.

-- 1. webhooks: the definition of a Call webhook, and the kind of every row.
do $$ begin
  if to_regclass('public.webhooks') is null then
    return;
  end if;
  execute $s$
    alter table webhooks
      add column if not exists kind text not null default 'event' check (kind in ('event', 'call')),
      add column if not exists object_type text,
      add column if not exists method text not null default 'POST' check (method in ('GET', 'POST', 'PUT', 'PATCH')),
      add column if not exists headers jsonb not null default '[]'::jsonb,
      add column if not exists payload_mode text not null default 'standard' check (payload_mode in ('standard', 'template')),
      add column if not exists template text,
      add column if not exists allow_personal_data boolean not null default false,
      add column if not exists timeout_ms integer not null default 15000 check (timeout_ms between 5000 and 30000),
      add column if not exists paused_reason text,
      add column if not exists legacy_key text,
      add column if not exists updated_at timestamptz
  $s$;
  execute 'create index if not exists webhooks_tenant_kind_idx on webhooks (tenant_id, kind)';
  execute 'create unique index if not exists webhooks_legacy_key_idx on webhooks (tenant_id, legacy_key) where legacy_key is not null';
end $$;

-- 2. References: a Coverage row names the webhook its accounts go to; a Monitor
--    row names the webhook that produced it.
do $$ begin
  if to_regclass('public.coverages') is not null and to_regclass('public.webhooks') is not null then
    execute 'alter table coverages add column if not exists webhook_id uuid references webhooks(id) on delete set null';
  end if;
  if to_regclass('public.integration_messages') is not null then
    execute 'alter table integration_messages add column if not exists webhook_id uuid';
    execute 'create index if not exists integration_messages_webhook_idx on integration_messages (tenant_id, webhook_id, created_at desc) where webhook_id is not null';
  end if;
end $$;

-- 3. Import the ERP push URL of every tenant that has one, as a Call webhook on
--    accounts. The stored secret is copied as it is (sealed or legacy plaintext:
--    the sender reads both), and allow_personal_data is ON because today's push
--    sends the decrypted account. A migrated http:// URL is kept but will not fire
--    until it is edited to https (the app marks it "needs https").
do $$ begin
  if to_regclass('public.webhooks') is null or to_regclass('public.tenants') is null then
    return;
  end if;
  execute $s$
    insert into webhooks (tenant_id, name, url, secret, kind, object_type, method, payload_mode, allow_personal_data, active, legacy_key)
    select t.id, 'ERP push', btrim(t.config -> 'integration_push' ->> 'webhook_url'),
           coalesce(nullif(t.config -> 'integration_push' ->> 'webhook_secret', ''),
                    'whsec_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
           'call', 'accounts', 'POST', 'standard', true, true, 'integration_push:default'
      from tenants t
     where coalesce(btrim(t.config -> 'integration_push' ->> 'webhook_url'), '') <> ''
    on conflict (tenant_id, legacy_key) where legacy_key is not null do nothing
  $s$;
  execute $s$
    insert into webhooks (tenant_id, name, url, secret, kind, object_type, method, payload_mode, allow_personal_data, active, legacy_key)
    select t.id, left(coalesce(nullif(btrim(e ->> 'name'), ''), 'ERP endpoint'), 80), btrim(e ->> 'webhook_url'),
           coalesce(nullif(e ->> 'webhook_secret', ''),
                    'whsec_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
           'call', 'accounts', 'POST', 'standard', true, true, 'integration_push:endpoint:' || (e ->> 'id')
      from tenants t
     cross join lateral jsonb_array_elements(
             case when jsonb_typeof(t.config -> 'integration_push' -> 'endpoints') = 'array'
                  then t.config -> 'integration_push' -> 'endpoints' else '[]'::jsonb end) as e
     where coalesce(btrim(e ->> 'webhook_url'), '') <> '' and coalesce(e ->> 'id', '') <> ''
    on conflict (tenant_id, legacy_key) where legacy_key is not null do nothing
  $s$;
end $$;

-- 4. Coverage rows that named an endpoint now name its webhook.
do $$ begin
  if to_regclass('public.webhooks') is null or to_regclass('public.coverages') is null then
    return;
  end if;
  execute $s$
    update coverages c
       set webhook_id = w.id
      from webhooks w
     where c.webhook_id is null
       and c.erp_endpoint_id is not null
       and w.tenant_id = c.tenant_id
       and w.legacy_key = 'integration_push:endpoint:' || c.erp_endpoint_id
  $s$;
end $$;

-- 5. The record button on Accounts ("Send to <webhook>") points at the imported
--    default ERP push, so the account button keeps sending where it sent before.
--    Read only when the webhooks_library flag is on; harmless otherwise.
do $$ begin
  if to_regclass('public.webhooks') is null or to_regclass('public.tenants') is null then
    return;
  end if;
  execute $s$
    update tenants t
       set config = jsonb_set(
             coalesce(t.config, '{}'::jsonb), '{webhooks_library}',
             coalesce(t.config -> 'webhooks_library', '{}'::jsonb)
               || jsonb_build_object('record_buttons',
                    coalesce(t.config -> 'webhooks_library' -> 'record_buttons', '{}'::jsonb)
                      || jsonb_build_object('accounts', w.id::text)))
      from webhooks w
     where w.tenant_id = t.id
       and w.legacy_key = 'integration_push:default'
       and coalesce(t.config -> 'webhooks_library' -> 'record_buttons' ->> 'accounts', '') = ''
  $s$;
end $$;

-- Ask PostgREST to reload its schema so the new columns are visible straight away.
notify pgrst, 'reload schema';
