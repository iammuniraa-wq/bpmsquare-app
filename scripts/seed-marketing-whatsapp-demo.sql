-- WhatsApp marketing: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0185_whatsapp_templates.sql and 0187_whatsapp_messages.sql (0186 and 0188 are
-- needed for sending; the consent ledger, 0139, for the opt-ins). Idempotent: a template that already exists (by
-- name and language) in a demo workspace is left alone, so it is safe to run twice. Touches ONLY tenants where
-- is_demo = true; never a client.
--
-- Per demo tenant it:
--   1. switches the whatsapp_marketing flag on (and marketing, which it needs);
--   2. adds three SAMPLE templates: "Quote ready" (marketing, approved), "Service reminder" (utility, approved)
--      and "New range" (marketing, DRAFT, so the Mark approved step can be shown);
--   3. records a WhatsApp opt-in, in the consent ledger, for up to three contacts that have a phone number,
--      with evidence {"sample": true}, so a send can be shown. Nobody else has WhatsApp consent, so everyone
--      else is refused, which is also worth showing;
--   4. writes a short sample message log (two sent, one delivered, one reply) for the first of those contacts.
--
-- It does NOT create the workspace's number: that is one click on Marketing, WhatsApp, Number and messages
-- (the number and the signing secret are encrypted by the app, which SQL cannot do). Until then a send says
-- "No WhatsApp number is set up". A demo workspace never reaches a real number in any case: with no test
-- number in config.whatsapp.redirect_number every message is only logged.

do $seed$
declare
  t         record;
  c         record;
  v_user    uuid;
  v_seq     int;
  v_first   uuid;
  v_first_acct uuid;
  v_quote   uuid;
  v_n       int;
begin
  for t in select id from tenants where is_demo = true loop
    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "whatsapp_marketing": true}'::jsonb
     where id = t.id;

    select user_id into v_user from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;

    -- 2. templates
    if not exists (select 1 from whatsapp_templates where tenant_id = t.id and lower(name) = 'quote ready' and language = 'en') then
      select coalesce(max((regexp_match(ref, '^WAT-(\d+)$'))[1]::int), 0) + 1 into v_seq from whatsapp_templates where tenant_id = t.id and ref ~ '^WAT-\d+$';
      insert into whatsapp_templates (tenant_id, ref, name, language, category, body, status, approved_at, topic, created_by)
      values (t.id, 'WAT-' || lpad(v_seq::text, 4, '0'), 'Quote ready', 'en', 'marketing',
              'Hello {{contact_name}}, your quote {{quote_ref}} is ready to review. Reply here if you have any questions.', 'approved', now(), null, v_user);
    end if;
    if not exists (select 1 from whatsapp_templates where tenant_id = t.id and lower(name) = 'service reminder' and language = 'en') then
      select coalesce(max((regexp_match(ref, '^WAT-(\d+)$'))[1]::int), 0) + 1 into v_seq from whatsapp_templates where tenant_id = t.id and ref ~ '^WAT-\d+$';
      insert into whatsapp_templates (tenant_id, ref, name, language, category, body, status, approved_at, topic, created_by)
      values (t.id, 'WAT-' || lpad(v_seq::text, 4, '0'), 'Service reminder', 'en', 'utility',
              'Hello {{contact_name}}, a reminder from {{company_name}}: your equipment is due for its service. Reply here to book a visit.', 'approved', now(), 'service_reminders', v_user);
    end if;
    if not exists (select 1 from whatsapp_templates where tenant_id = t.id and lower(name) = 'new range' and language = 'en') then
      select coalesce(max((regexp_match(ref, '^WAT-(\d+)$'))[1]::int), 0) + 1 into v_seq from whatsapp_templates where tenant_id = t.id and ref ~ '^WAT-\d+$';
      insert into whatsapp_templates (tenant_id, ref, name, language, category, body, status, topic, created_by)
      values (t.id, 'WAT-' || lpad(v_seq::text, 4, '0'), 'New range', 'en', 'marketing',
              'Hello {{contact_name}}, we have added a new range at {{company_name}}. Reply here and we will send you the details.', 'draft', 'new_products', v_user);
    end if;

    -- 3. WhatsApp opt-ins for up to three contacts with a phone number
    v_n := 0;
    v_first := null;
    for c in
      select ct.id, ct.account_id from contacts ct
       where ct.tenant_id = t.id and ct.phone is not null and ct.phone <> ''
         and not exists (select 1 from consent_state s where s.tenant_id = t.id and s.contact_id = ct.id and s.channel = 'whatsapp')
       order by ct.created_at limit 3
    loop
      insert into consent_events (tenant_id, contact_id, account_id, channel, topic, status, basis, jurisdiction, source, evidence, created_by)
      values (t.id, c.id, c.account_id, 'whatsapp', null, 'granted', 'consent', 'SA', 'rep', '{"sample": true, "note": "Sample opt-in for the demo"}'::jsonb, v_user);
      insert into consent_state (tenant_id, contact_id, channel, topic, status, basis, jurisdiction)
      values (t.id, c.id, 'whatsapp', '', 'granted', 'consent', 'SA')
      on conflict (tenant_id, contact_id, channel, topic) do nothing;
      v_n := v_n + 1;
      if v_first is null then v_first := c.id; v_first_acct := c.account_id; end if;
    end loop;

    -- 4. a short sample message log for the first of them, once
    if v_first is not null and not exists (select 1 from whatsapp_messages where tenant_id = t.id and client_ref like 'sample-%') then
      select id into v_quote from whatsapp_templates where tenant_id = t.id and lower(name) = 'quote ready' and language = 'en';
      insert into whatsapp_messages (tenant_id, direction, contact_id, account_id, template_id, kind, origin, status, category, lang, body, provider, client_ref, sent_at, delivered_at, created_at)
      values
        (t.id, 'out', v_first, v_first_acct, v_quote, 'template', 'rep', 'delivered', 'marketing', 'en', 'Hello, your quote is ready to review. Reply here if you have any questions.', 'sandbox', 'sample-1', now() - interval '12 days', now() - interval '12 days', now() - interval '12 days'),
        (t.id, 'in',  v_first, v_first_acct, null, 'inbound', 'provider', 'received', null, null, 'Thanks, can you send the delivery dates?', 'sandbox', null, null, null, now() - interval '12 days' + interval '2 hours'),
        (t.id, 'out', v_first, v_first_acct, v_quote, 'template', 'rep', 'dry_run', 'marketing', 'en', 'Hello, your quote is ready to review. Reply here if you have any questions.', 'sandbox', 'sample-2', now() - interval '8 days', null, now() - interval '8 days');
      update whatsapp_messages set received_at = created_at where tenant_id = t.id and direction = 'in' and received_at is null;
    end if;
  end loop;
end
$seed$;
