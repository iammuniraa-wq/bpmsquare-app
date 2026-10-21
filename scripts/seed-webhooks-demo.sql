-- Webhooks library: demo switch and two sample webhooks for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0202_webhooks_library.sql.
-- Idempotent. Touches ONLY tenants where is_demo = true; never a client.
--
-- It switches the webhooks_library flag on and adds two sample rows (a Call webhook
-- for accounts and an Event webhook), marked by legacy_key 'demo:*' so a second run
-- adds nothing. A demo workspace never sends a webhook (the call is recorded as
-- "redirected" in the Monitor), so the sample addresses are never contacted.

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"webhooks_library": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'webhooks_library')::boolean, false) = false;

insert into webhooks (tenant_id, name, url, secret, kind, object_type, method, payload_mode, allow_personal_data, active, legacy_key)
select t.id, 'Sample: send an account', 'https://example.com/bpmsquare/accounts',
       'whsec_demo' || replace(gen_random_uuid()::text, '-', ''),
       'call', 'accounts', 'POST', 'standard', false, true, 'demo:call-accounts'
  from tenants t
 where t.is_demo = true
on conflict (tenant_id, legacy_key) where legacy_key is not null do nothing;

insert into webhooks (tenant_id, name, url, secret, kind, object_types, active, legacy_key)
select t.id, 'Sample: change feed', 'https://example.com/bpmsquare/changes',
       'whsec_demo' || replace(gen_random_uuid()::text, '-', ''),
       'event', '["accounts", "standard_quotes"]'::jsonb, false, 'demo:event-feed'
  from tenants t
 where t.is_demo = true
on conflict (tenant_id, legacy_key) where legacy_key is not null do nothing;
