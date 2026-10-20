-- Newsletter Studio: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0141_newsletters.sql. Idempotent: a template or
-- newsletter that already exists (by name) in a demo workspace is left alone, so
-- it is safe to run twice. Touches ONLY tenants where is_demo = true; never a client.
--
-- It does five things per demo tenant:
--   1. switches the newsletter_studio feature flag on (and marketing, which it needs);
--   2. gives the workspace a brand kit if it has none (navy and amber, the colours of the
--      mock-up's sample company), so the first design already looks like somebody's;
--   3. adds four templates: a monthly update, an offer, a general festival greeting and an
--      Eid greeting in English and Arabic (the Arabic is marked "translated": a person
--      accepts it before it can be sent, exactly as a real translation would be);
--   4. adds one sample newsletter, "October update (sample)", from
--      docs/design/newsletter-studio-mockup.html, in English with the Arabic added on top
--      and waiting for its "Check this" review.
--   5. if the workspace has chosen no consent rule yet, lets existing customers be emailed in the Gulf
--      jurisdictions so the sample can be sent end to end. The product's default is strict (everyone needs a
--      recorded yes), and a demo workspace's email is redirected to one internal inbox in any case, so this
--      is safe here and is NOT something to copy to a client: that choice is the client's admin's, made in
--      Settings -> Marketing -> Consent and topics.
-- Everything is owned by the workspace's oldest admin. Nothing here sends an email.
--
-- Words are structured blocks plus per-language texts -- never HTML (see 0141).

create or replace function pg_temp.nl_seed(p_tenant uuid, p_user uuid, p jsonb)
returns void
language plpgsql
as $fn$
declare
  v_id    uuid;
  v_ref   text;
  v_seq   int;
  l       jsonb;
begin
  if exists (select 1 from newsletters where tenant_id = p_tenant and name = p->>'name' and is_template = (p->>'is_template')::boolean) then
    return;
  end if;

  select coalesce(max((regexp_match(ref, '^NWS-(\d+)$'))[1]::int), 0) + 1 into v_seq
    from newsletters where tenant_id = p_tenant and ref ~ '^NWS-\d+$';
  v_ref := 'NWS-' || lpad(v_seq::text, 4, '0');

  insert into newsletters (tenant_id, ref, name, is_template, category, status, source_language, blocks, created_by)
  values (p_tenant, v_ref, p->>'name', (p->>'is_template')::boolean, p->>'category', p->>'status', 'en', p->'blocks', p_user)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p->'languages') loop
    insert into newsletter_languages (tenant_id, newsletter_id, lang, dir, subject, preheader, texts, review, status, translated_by)
    values (p_tenant, v_id, l->>'lang', l->>'dir', l->>'subject', l->>'preheader', l->'texts', l->'review', l->>'status', l->>'translated_by');
  end loop;
end
$fn$;

do $seed$
declare
  t record;
  v_user uuid;
begin
  for t in select id from tenants where is_demo = true loop
    select user_id into v_user from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;

    update tenants
       set features = coalesce(features, '{}'::jsonb) || '{"marketing": true, "newsletter_studio": true}'::jsonb,
           config = case
             when coalesce(config, '{}'::jsonb) ? 'brand_kit' then config
             else coalesce(config, '{}'::jsonb) || jsonb_build_object('brand_kit', jsonb_build_object(
               'primary', '#16365c', 'secondary', '#c8892a', 'text', '#1c2733', 'font_pairing', 'arial', 'tone', 'formal',
               'footer_address', E'Industrial Area, Street 24, Doha\n+974 4400 0000'))
           end
     where id = t.id;

    update tenants
       set config = jsonb_set(coalesce(config, '{}'::jsonb), '{marketing}',
             coalesce(config->'marketing', '{}'::jsonb) || jsonb_build_object('consent_defaults', jsonb_build_object(
               'SA', 'existing_customer', 'AE', 'existing_customer', 'QA', 'existing_customer',
               'KW', 'existing_customer', 'OM', 'existing_customer', 'BH', 'existing_customer')))
     where id = t.id
       and not (coalesce(config->'marketing', '{}'::jsonb) ? 'consent_defaults');

    -- ── Template: Monthly update ───────────────────────────────────────────
    perform pg_temp.nl_seed(t.id, v_user, $j${
      "name": "Monthly update", "is_template": true, "category": "Newsletter", "status": "ready",
      "blocks": [
        {"id":"header1","type":"header","visible":true,"locked":true,"settings":{}},
        {"id":"hero1","type":"hero","visible":true,"settings":{}},
        {"id":"text1","type":"text","visible":true,"settings":{}},
        {"id":"product1","type":"product","visible":true,"settings":{}},
        {"id":"button1","type":"button","visible":true,"settings":{}},
        {"id":"columns1","type":"columns","visible":true,"settings":{}},
        {"id":"interest1","type":"interest","visible":true,"settings":{}},
        {"id":"footer1","type":"footer","visible":true,"locked":true,"settings":{}}
      ],
      "languages": [{
        "lang":"en","dir":"ltr","status":"ready","translated_by":"person",
        "subject":"Your update from {{company_name}}","preheader":"Three things worth a minute of your time",
        "review":{"header1":"written","hero1":"written","text1":"written","product1":"written","button1":"written","columns1":"written","interest1":"written","footer1":"written"},
        "texts":{
          "header1":{"tag":""},
          "hero1":{"title":"What is new this month","text":"Three things worth a minute of your time."},
          "text1":{"text":"Dear {{account_name}},\nA short note on what has changed and what is coming."},
          "product1":{"name":"Featured product","text":"One line about why it matters.","price":"","from":""},
          "button1":{"label":"See more"},
          "columns1":{"t1":"First topic","p1":"A few words.","t2":"Second topic","p2":"A few words."},
          "interest1":{"label":"Interested? Tell us more"},
          "footer1":{"text":"You receive this because you are a customer of {{company_name}}.","unsub":"Unsubscribe","prefs":"Manage preferences"}
        }
      }]
    }$j$::jsonb);

    -- ── Template: Offer ────────────────────────────────────────────────────
    perform pg_temp.nl_seed(t.id, v_user, $j${
      "name": "Offer", "is_template": true, "category": "Offer", "status": "ready",
      "blocks": [
        {"id":"header1","type":"header","visible":true,"locked":true,"settings":{}},
        {"id":"hero1","type":"hero","visible":true,"settings":{}},
        {"id":"text1","type":"text","visible":true,"settings":{}},
        {"id":"columns1","type":"columns","visible":true,"settings":{}},
        {"id":"button1","type":"button","visible":true,"settings":{}},
        {"id":"footer1","type":"footer","visible":true,"locked":true,"settings":{}}
      ],
      "languages": [{
        "lang":"en","dir":"ltr","status":"ready","translated_by":"person",
        "subject":"A special offer for {{account_name}}","preheader":"Valid for a limited period",
        "review":{"header1":"written","hero1":"written","text1":"written","columns1":"written","button1":"written","footer1":"written"},
        "texts":{
          "header1":{"tag":""},
          "hero1":{"title":"A special offer","text":"Our thanks for working with us."},
          "text1":{"text":"Dear {{account_name}},\nFor a limited period we are offering you the following."},
          "columns1":{"t1":"The offer","p1":"Describe it in one or two lines.","t2":"How to claim it","p2":"Reply to this email or call us."},
          "button1":{"label":"Claim the offer"},
          "footer1":{"text":"You receive this because you are a customer of {{company_name}}.","unsub":"Unsubscribe","prefs":"Manage preferences"}
        }
      }]
    }$j$::jsonb);

    -- ── Template: a general festival greeting ──────────────────────────────
    perform pg_temp.nl_seed(t.id, v_user, $j${
      "name": "Festival greeting", "is_template": true, "category": "Festival", "status": "ready",
      "blocks": [
        {"id":"header1","type":"header","visible":true,"locked":true,"settings":{}},
        {"id":"hero1","type":"hero","visible":true,"settings":{}},
        {"id":"text1","type":"text","visible":true,"settings":{}},
        {"id":"footer1","type":"footer","visible":true,"locked":true,"settings":{}}
      ],
      "languages": [{
        "lang":"en","dir":"ltr","status":"ready","translated_by":"person",
        "subject":"Season's greetings from {{company_name}}","preheader":"With our warmest wishes",
        "review":{"header1":"written","hero1":"written","text1":"written","footer1":"written"},
        "texts":{
          "header1":{"tag":"Season's greetings"},
          "hero1":{"title":"Warmest wishes","text":"To you, your team and your family."},
          "text1":{"text":"Dear {{account_name}},\nThank you for your trust this year. We wish you a joyful festival and a prosperous year ahead."},
          "footer1":{"text":"You receive this because you are a customer of {{company_name}}.","unsub":"Unsubscribe","prefs":"Manage preferences"}
        }
      }]
    }$j$::jsonb);

    -- ── Template: Eid greeting, English and Arabic ─────────────────────────
    perform pg_temp.nl_seed(t.id, v_user, $j${
      "name": "Eid greeting", "is_template": true, "category": "Festival", "status": "draft",
      "blocks": [
        {"id":"header1","type":"header","visible":true,"locked":true,"settings":{}},
        {"id":"hero1","type":"hero","visible":true,"settings":{}},
        {"id":"text1","type":"text","visible":true,"settings":{}},
        {"id":"footer1","type":"footer","visible":true,"locked":true,"settings":{}}
      ],
      "languages": [
        {
          "lang":"en","dir":"ltr","status":"ready","translated_by":"person",
          "subject":"Eid Mubarak from {{company_name}}","preheader":"Warm wishes to you and your team",
          "review":{"header1":"written","hero1":"written","text1":"written","footer1":"written"},
          "texts":{
            "header1":{"tag":"Eid Mubarak"},
            "hero1":{"title":"Eid Mubarak","text":"Warm wishes to you and your team."},
            "text1":{"text":"Dear {{account_name}},\nOn behalf of everyone at {{company_name}}, we wish you and your family a blessed Eid. Thank you for your trust this year."},
            "footer1":{"text":"You receive this because you are a customer of {{company_name}}.","unsub":"Unsubscribe","prefs":"Manage preferences"}
          }
        },
        {
          "lang":"ar","dir":"rtl","status":"draft","translated_by":"ai",
          "subject":"عيد مبارك من {{company_name}}","preheader":"أطيب التمنيات لكم ولفريقكم",
          "review":{"header1":"translated","hero1":"translated","text1":"translated","footer1":"translated"},
          "texts":{
            "header1":{"tag":"عيد مبارك"},
            "hero1":{"title":"عيد مبارك","text":"أطيب التمنيات لكم ولفريقكم."},
            "text1":{"text":"عزيزنا {{account_name}}،\nباسم جميع العاملين في {{company_name}}، نتمنى لكم ولعائلتكم عيداً مباركاً. نشكركم على ثقتكم بنا هذا العام."},
            "footer1":{"text":"تصلك هذه الرسالة لأنك من عملاء {{company_name}}.","unsub":"إلغاء الاشتراك","prefs":"إدارة التفضيلات"}
          }
        }
      ]
    }$j$::jsonb);

    -- ── The sample newsletter (the mock-up's October update) ───────────────
    perform pg_temp.nl_seed(t.id, v_user, $j${
      "name": "October update (sample)", "is_template": false, "category": "Newsletter", "status": "draft",
      "blocks": [
        {"id":"header1","type":"header","visible":true,"locked":true,"settings":{}},
        {"id":"hero1","type":"hero","visible":true,"settings":{}},
        {"id":"text1","type":"text","visible":true,"settings":{}},
        {"id":"product1","type":"product","visible":true,"settings":{}},
        {"id":"button1","type":"button","visible":true,"settings":{"url":"https://example.com/anchors"}},
        {"id":"columns1","type":"columns","visible":true,"settings":{}},
        {"id":"divider1","type":"divider","visible":true,"settings":{}},
        {"id":"interest1","type":"interest","visible":true,"settings":{}},
        {"id":"footer1","type":"footer","visible":true,"locked":true,"settings":{}}
      ],
      "languages": [
        {
          "lang":"en","dir":"ltr","status":"ready","translated_by":"person",
          "subject":"New anchors range, Saturday opening and 10% off harnesses","preheader":"Your October update",
          "review":{"header1":"written","hero1":"written","text1":"written","product1":"written","button1":"written","columns1":"written","divider1":"written","interest1":"written","footer1":"written"},
          "texts":{
            "header1":{"tag":"October 2026"},
            "hero1":{"title":"October at {{company_name}}","text":"Three things worth a minute of your time this month."},
            "text1":{"text":"Dear {{account_name}},\nOur Doha warehouse now opens on Saturdays, 8 am to 1 pm, so your site teams can collect urgent orders without waiting for Sunday."},
            "product1":{"name":"HST4 wedge anchor M12","text":"Approved for cracked concrete. In stock in Doha.","price":"QAR 14.50 / pc","from":"From your catalogue"},
            "button1":{"label":"See the full anchors range"},
            "columns1":{"t1":"10% off safety harnesses","p1":"Until 31 October, on all full-body harnesses.","t2":"Free site delivery","p2":"Orders over QAR 2,000 across Doha and Al Wakrah."},
            "interest1":{"label":"Interested? Tell us more"},
            "footer1":{"text":"Industrial Area, Street 24, Doha\nYou receive this because you are a customer of {{company_name}}.","unsub":"Unsubscribe","prefs":"Manage preferences"}
          }
        },
        {
          "lang":"ar","dir":"rtl","status":"draft","translated_by":"ai",
          "subject":"تشكيلة مراسي جديدة، فتح يوم السبت وخصم 10٪ على أحزمة الأمان","preheader":"تحديث أكتوبر",
          "review":{"header1":"translated","hero1":"translated","text1":"translated","product1":"translated","button1":"translated","columns1":"translated","divider1":"written","interest1":"translated","footer1":"translated"},
          "texts":{
            "header1":{"tag":"أكتوبر 2026"},
            "hero1":{"title":"أكتوبر في {{company_name}}","text":"ثلاثة أمور تستحق دقيقة من وقتك هذا الشهر."},
            "text1":{"text":"عزيزنا {{account_name}}،\nمستودعنا في الدوحة يفتح الآن أيام السبت من 8 صباحاً حتى 1 ظهراً، ليتمكن فريق موقعكم من استلام الطلبات العاجلة دون انتظار يوم الأحد."},
            "product1":{"name":"HST4 wedge anchor M12","text":"معتمدة للخرسانة المتشققة. متوفرة في الدوحة.","price":"QAR 14.50 / pc","from":"من الكتالوج"},
            "button1":{"label":"اطّلع على تشكيلة المراسي الكاملة"},
            "columns1":{"t1":"خصم 10٪ على أحزمة الأمان","p1":"حتى 31 أكتوبر على جميع أحزمة الجسم الكاملة.","t2":"توصيل مجاني إلى الموقع","p2":"للطلبات التي تزيد عن 2,000 ر.ق في الدوحة والوكرة."},
            "interest1":{"label":"مهتم؟ أخبرنا المزيد"},
            "footer1":{"text":"المنطقة الصناعية، شارع 24، الدوحة\nتصلك هذه الرسالة لأنك من عملاء {{company_name}}.","unsub":"إلغاء الاشتراك","prefs":"إدارة التفضيلات"}
          }
        }
      ]
    }$j$::jsonb);
  end loop;
end
$seed$;
