-- Demo contacts with an email and a recorded "yes", so a plain campaign can really be sent on the DEMO tenant
-- (docs/design/marketing-two-parts.md section 10). Run AFTER 0139_consent_ledger.sql. Never run on a real
-- workspace: it only touches tenants where is_demo = true, and exits quietly if there is none.
--
-- Why this exists: the campaign send mails an account's email address to a contact of that account who has
-- consent. The demo accounts have neither, so every recipient read "left out" and a send could not be shown.
--
-- What it does, per is_demo tenant (idempotent; a second run changes nothing):
--   * up to 8 accounts without an email get marketing.demo+<ref>@example.com (plain text; decrypt() passes it through)
--   * each of those accounts gets one contact "Marketing contact (sample)" with the same address
--   * each contact gets a recorded email "yes" for every topic (consent_events + consent_state)
--   * the marketing feature is switched on for the demo tenant
-- Every message from a demo workspace is redirected to the owner's inbox by the email safeguard
-- (src/lib/emailOutput.ts), whatever the address, so nothing reaches example.com.
-- The contacts' blind-index hash (email_hash) cannot be computed in SQL; an address TYPED into a campaign is
-- therefore found only after the contact is created in the app, which is the behaviour the demo should show.

do $$
declare
  t record;
  a record;
  seq_con int;
  con uuid;
  addr text;
  n int;
  has_consent boolean := to_regclass('public.consent_state') is not null and to_regclass('public.consent_events') is not null;
begin
  if not has_consent then
    raise notice 'Consent ledger (0139) is not applied -- nothing seeded';
    return;
  end if;

  for t in select id from tenants where is_demo = true loop
    update tenants set features = coalesce(features, '{}'::jsonb) || '{"marketing": true}'::jsonb where id = t.id;
    select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) into seq_con from contacts where tenant_id = t.id and ref ~ '^CON-\d+$';
    n := 0;
    for a in
      select id, ref from accounts
      where tenant_id = t.id and coalesce(email, '') = ''
      order by created_at, id
      limit 8
    loop
      addr := 'marketing.demo+' || lower(regexp_replace(coalesce(a.ref, a.id::text), '[^A-Za-z0-9]+', '', 'g')) || '@example.com';
      update accounts set email = addr where id = a.id and tenant_id = t.id;

      select id into con from contacts where tenant_id = t.id and account_id = a.id and email = addr limit 1;
      if con is null then
        seq_con := seq_con + 1;
        insert into contacts (tenant_id, ref, account_id, name, role, email)
        values (t.id, 'CON-' || lpad(seq_con::text, 4, '0'), a.id, 'Marketing contact (sample)', 'Marketing contact', addr)
        returning id into con;
      end if;

      if not exists (select 1 from consent_state where tenant_id = t.id and contact_id = con and channel = 'email' and topic = '') then
        insert into consent_events (tenant_id, contact_id, account_id, channel, topic, status, basis, jurisdiction, source, evidence)
        values (t.id, con, a.id, 'email', null, 'granted', 'consent', 'other', 'import', '{"seed":"marketing-demo-contacts"}'::jsonb);
        insert into consent_state (tenant_id, contact_id, channel, topic, status, basis, jurisdiction)
        values (t.id, con, 'email', '', 'granted', 'consent', 'other')
        on conflict (tenant_id, contact_id, channel, topic) do nothing;
      end if;
      n := n + 1;
    end loop;
    raise notice 'Demo tenant %: % account(s) given a contact with consent', t.id, n;
  end loop;
end $$;
