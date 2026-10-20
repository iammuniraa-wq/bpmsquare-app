-- Forms and the preference centre: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0170_forms.sql (and 0171 for the sample answers). Idempotent:
-- a form that already exists (by address) in a demo workspace is left alone, and sample answers
-- are only added to a form that has none, so it is safe to run twice. Touches ONLY tenants where
-- is_demo = true; never a client.
--
-- Per demo tenant it:
--   1. switches the marketing_forms feature flag on (and marketing, which it needs);
--   2. adds two LIVE forms: "Website contact form" (name, company, email, phone, message, with a
--      consent box covering Offers and New products) and "Newsletter sign-up" (name and email
--      only), both saying the thank-you in a message;
--   3. adds three sample answers to the contact form so the Answers list is not empty. They are
--      stored as plain text (the app reads an unencrypted value as it is); a real submit stores
--      them encrypted. No contact, lead or consent row is made by this script.
-- Nothing here sends an email. The public address of a demo form is
-- https://<demo domain>/f/contact-us once this has run.

create or replace function pg_temp.frm_seed(p_tenant uuid, p_user uuid, p jsonb)
returns void
language plpgsql
as $fn$
declare
  v_seq int;
begin
  if exists (select 1 from forms where tenant_id = p_tenant and slug = p->>'slug') then
    return;
  end if;
  select coalesce(max((regexp_match(ref, '^FRM-(\d+)$'))[1]::int), 0) + 1 into v_seq
    from forms where tenant_id = p_tenant and ref ~ '^FRM-\d+$';
  insert into forms (tenant_id, ref, name, slug, public_key, status, title, intro, button_label, fields, consent, after_submit, created_by)
  values (
    p_tenant, 'FRM-' || lpad(v_seq::text, 4, '0'), p->>'name', p->>'slug',
    'frm_demo' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), 'live',
    p->>'title', p->>'intro', p->>'button', p->'fields', p->'consent', p->'after', p_user
  );
end;
$fn$;

do $$
declare
  t record;
  u uuid;
  f uuid;
begin
  for t in select id from tenants where is_demo = true loop
    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "marketing_forms": true}'::jsonb
     where id = t.id;

    select user_id into u from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;

    perform pg_temp.frm_seed(t.id, u, $j${
      "name": "Website contact form", "slug": "contact-us", "title": "Contact us",
      "intro": "Tell us a little about what you need and we will get back to you within one working day.", "button": "Send",
      "fields": [
        {"key":"name","label":"Your name","required":true,"enabled":true},
        {"key":"company","label":"Company","required":false,"enabled":true},
        {"key":"email","label":"Email","required":true,"enabled":true},
        {"key":"phone","label":"Phone","required":false,"enabled":true},
        {"key":"message","label":"How can we help?","required":false,"enabled":true},
        {"key":"custom1","label":"Question 1","required":false,"enabled":false},
        {"key":"custom2","label":"Question 2","required":false,"enabled":false},
        {"key":"custom3","label":"Question 3","required":false,"enabled":false}
      ],
      "consent": {"text": "I agree to receive offers and news about new products by email. I can change my mind at any time.", "topics": ["offers", "new_products"], "required": false},
      "after": {"kind": "message", "message": "Thank you. We have your message and will be in touch soon.", "redirect_url": ""}
    }$j$::jsonb);

    perform pg_temp.frm_seed(t.id, u, $j${
      "name": "Newsletter sign-up", "slug": "newsletter", "title": "Get our newsletter",
      "intro": "A short email when we have something worth your time.", "button": "Sign me up",
      "fields": [
        {"key":"name","label":"Your name","required":false,"enabled":true},
        {"key":"company","label":"Company","required":false,"enabled":false},
        {"key":"email","label":"Email","required":true,"enabled":true},
        {"key":"phone","label":"Phone","required":false,"enabled":false},
        {"key":"message","label":"How can we help?","required":false,"enabled":false},
        {"key":"custom1","label":"Question 1","required":false,"enabled":false},
        {"key":"custom2","label":"Question 2","required":false,"enabled":false},
        {"key":"custom3","label":"Question 3","required":false,"enabled":false}
      ],
      "consent": {"text": "Yes, send me the newsletter by email. I can unsubscribe at any time.", "topics": ["new_products"], "required": true},
      "after": {"kind": "message", "message": "You are on the list. Thank you.", "redirect_url": ""}
    }$j$::jsonb);

    select id into f from forms where tenant_id = t.id and slug = 'contact-us';
    if f is not null and not exists (select 1 from form_submissions where tenant_id = t.id and form_id = f) then
      insert into form_submissions (tenant_id, form_id, answers, consent_given, outcome, ua_family, created_at) values
        (t.id, f, '{"name":"Hamad Al Mansoori","company":"Gulf Precast","email":"hamad@gulfprecast.example","message":"We need a quote for 40 boundary walls."}'::jsonb, true,  'created', 'Chrome',  now() - interval '2 days'),
        (t.id, f, '{"name":"Priya Nair","company":"Blue Wave Contracting","email":"priya@bluewave.example","phone":"+971 50 555 0100","message":"Do you deliver to Fujairah?"}'::jsonb, false, 'created', 'Safari',  now() - interval '1 day'),
        (t.id, f, '{"name":"Omar Haddad","email":"omar@haddad.example","message":"Please send the product catalogue."}'::jsonb, true, 'matched', 'Firefox', now() - interval '3 hours');
    end if;
  end loop;
end
$$;
