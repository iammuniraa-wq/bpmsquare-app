-- Process Design Studio: demo data for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0152_process_studio.sql. Idempotent: a sample
-- that already exists (by name) in a demo workspace is left alone, so it is safe
-- to run twice. Touches ONLY tenants where is_demo = true; never a client.
--
-- It does three things per demo tenant:
--   1. switches the process_studio feature flag on (demo tenants only);
--   2. adds two labelled samples, "Al-Khaleej Precast (sample)" and "Hosapete
--      Motor Works (sample)", from docs/design/process-design-studio-mockup.html,
--      as finished studies (plan ready, not yet sent) so a prospect can open one,
--      press Send, and see the whole flow without typing an answer;
--   3. owns them by the workspace's oldest admin. A study is private to its
--      creator on the demo workspace, so only that person sees the samples.
--
-- Every citation is a real catalogue id (src/lib/capability/generate.ts), and the
-- ratings obey the same rules the app enforces (src/lib/studio/ratings.ts).
-- The sample plan dates are computed by the app from plan_start_date + durations.

create or replace function pg_temp.ps_seed_sample(p_tenant uuid, p_user uuid, p jsonb)
returns void
language plpgsql
as $fn$
declare
  v_study uuid;
  v_ref   text;
  v_seq   int;
  s       jsonb;
  c       jsonb;
  k       text;
  v_id    uuid;
  v_map   jsonb := '{}'::jsonb;
  v_ids   uuid[];
  i       int := 0;
begin
  if exists (select 1 from process_studies where tenant_id = p_tenant and name = p->>'name') then
    return;
  end if;

  select coalesce(max((regexp_match(ref, '^STU-(\d+)$'))[1]::int), 0) + 1 into v_seq
    from process_studies where tenant_id = p_tenant and ref ~ '^STU-\d+$';
  v_ref := 'STU-' || lpad(v_seq::text, 4, '0');

  insert into process_studies (tenant_id, ref, name, status, reached, created_by, areas, lanes, summary, noticed,
                               plan_start_date, weekend, contact_name)
  values (p_tenant, v_ref, p->>'name', 'plan_ready', 5, p_user, coalesce(p->'areas', '{}'::jsonb), '[]'::jsonb,
          p->>'summary', coalesce(p->'noticed', '[]'::jsonb), (p->>'start')::date, p->>'weekend', null)
  returning id into v_study;

  for s in select * from jsonb_array_elements(p->'chat') loop
    insert into process_study_messages (tenant_id, study_id, role, text, understood, questions)
    values (p_tenant, v_study, s->>'role', s->>'text', coalesce(s->'understood', '[]'::jsonb), coalesce(s->'questions', '[]'::jsonb));
  end loop;

  for s in select * from jsonb_array_elements(p->'steps') loop
    i := i + 10;
    insert into process_study_steps (tenant_id, study_id, area, lane, sort_order, name, how_today, assumed, hands_over)
    values (p_tenant, v_study, s->>'area', s->>'lane', i, s->>'name', s->>'how', coalesce((s->>'assumed')::boolean, false), coalesce((s->>'hands')::boolean, false))
    returning id into v_id;
    v_map := v_map || jsonb_build_object(s->>'key', v_id);
    insert into process_study_fit (tenant_id, study_id, step_id, rating, capability_ids, why, confidence)
    values (p_tenant, v_study, v_id, s->>'rating',
            coalesce((select array_agg(x) from jsonb_array_elements_text(s->'caps') x), '{}'),
            s->>'why', coalesce(s->>'conf', 'sure'));
  end loop;

  i := 0;
  for c in select * from jsonb_array_elements(p->'changes') loop
    i := i + 10;
    v_ids := coalesce((select array_agg((v_map->>x)::uuid) from jsonb_array_elements_text(c->'steps') x), '{}');
    insert into process_study_changes (tenant_id, study_id, kind, title, plain, alternative, effort_band, step_ids, extension_hook, connector, sort_order)
    values (p_tenant, v_study, c->>'kind', c->>'title', c->>'plain', nullif(c->>'alt', ''), c->>'band', v_ids,
            nullif(c->>'hook', ''), nullif(c->>'connector', ''), i);
  end loop;

  i := 0;
  for c in select * from jsonb_array_elements(p->'tasks') loop
    i := i + 10;
    insert into process_study_tasks (tenant_id, study_id, phase, sort_order, name, owner, duration_days, milestone, from_template)
    values (p_tenant, v_study, c->>'phase', i, c->>'name', c->>'owner', (c->>'days')::int, coalesce((c->>'ms')::boolean, false), true);
  end loop;
end
$fn$;

do $$
declare
  t record;
  u uuid;
begin
  update tenants
     set features = coalesce(features, '{}'::jsonb) || '{"process_studio": true}'::jsonb
   where is_demo = true;

  for t in select id from tenants where is_demo = true loop
    select user_id into u from tenant_users where tenant_id = t.id and role = 'admin' order by created_at limit 1;
    if u is null then continue; end if;

    perform pg_temp.ps_seed_sample(t.id, u, $j$
{
  "name": "Al-Khaleej Precast (sample)", "weekend": "fri_sat", "start": "2026-11-02",
  "summary": "Precast manufacturer in Dammam: villas, boundary walls and car-park structures for contractors. Enquiries arrive as drawings by email, an estimator prices the panels in Excel, bids go to tender, the factory casts and delivers.",
  "noticed": ["Estimates needs Standard Quotes switched on with it; the plan includes both.", "You will load your customer and product lists once; the Data Workbench does it from a spreadsheet.", "Dynamics 365: a connector exists but has not run with a client yet. We treat the ERP as a phase after go-live and say so on the call."],
  "chat": [
    {"role": "studio", "text": "Tell us about your business in your own words: what you make, who your customers are, and how a job goes from the first enquiry to getting paid."},
    {"role": "client", "text": "We are a precast concrete manufacturer in Dammam. Contractors send us drawings for villas, boundary walls and car parks. Our estimator takes the element schedule, prices the panels in Excel, and we submit a bid. If we win, the factory casts, we deliver by truck and erect on site. We have about 180 factory workers on two shifts."},
    {"role": "studio", "text": "Thank you. A few questions:", "questions": ["Who checks a bid before it goes out: the sales manager, the GM, or both?", "Do you buy rebar and cement per project, or on standing contracts?", "How do you plan deliveries today: a spreadsheet, the ERP, or by phone?"],
     "understood": [{"fact": "Precast manufacturer, Dammam", "kind": "stated"}, {"fact": "Customers: contractors", "kind": "stated"}, {"fact": "Pricing in Excel from element schedule", "kind": "stated"}, {"fact": "180 workers, 2 shifts", "kind": "stated"}, {"fact": "Erection by own crews", "kind": "assumed"}]},
    {"role": "client", "text": "The sales manager checks every bid, the GM only above 2 million. Rebar is on a yearly contract, cement we buy per project from three suppliers. Deliveries are planned in a spreadsheet by the yard supervisor, and we are moving to Dynamics 365 next year."}
  ],
  "steps": [
    {"key": "s1", "area": "sales", "lane": "Sales manager", "name": "Receive enquiry with drawings", "how": "Email from contractor", "hands": true, "rating": "standard", "caps": ["cap.module.accounts", "cap.module.leads"], "why": "An enquiry becomes a lead or a deal on the account; the drawings attach to it."},
    {"key": "s2", "area": "sales", "lane": "Estimator", "name": "Price panels from element schedule", "how": "Excel, per project", "rating": "needs_setup", "caps": ["cap.module.estimator", "cap.setting.estimate_templates"], "why": "Estimates reads your element schedule as a spreadsheet and prices from a template your admin sets up with your rates and rules. Your Excel becomes the template."},
    {"key": "s3", "area": "sales", "lane": "Sales manager", "name": "Approve and submit bid", "how": "Email; GM above 2M", "rating": "partly", "caps": ["cap.module.pipeline", "cap.module.standard_quotes"], "why": "A deal moves through stages and a quote has a status flow, but a rule that the GM must approve above 2 million is not a setting today.", "conf": "likely"},
    {"key": "s4", "area": "sales", "lane": "Sales manager", "name": "Send quote, receive PO", "how": "Email, PDF", "rating": "standard", "caps": ["cap.module.standard_quotes"], "why": "Quote PDF and email from the estimate; the PO is recorded on the deal."},
    {"key": "s5", "area": "production", "lane": "Estimator", "name": "Prepare bill of materials per element", "how": "Excel", "rating": "standard", "caps": ["cap.object.product", "cap.module.estimator"], "why": "An estimate produces the bill of materials per element; products can be kits with components."},
    {"key": "s6", "area": "production", "lane": "Yard supervisor", "name": "Plan casting by mould and day", "how": "Whiteboard and spreadsheet", "rating": "not_covered", "caps": [], "why": "There is no casting or mould schedule in BPMSquare. The estimate gives the quantities; the plan itself stays in your spreadsheet or your ERP."},
    {"key": "s7", "area": "production", "lane": "Yard supervisor", "name": "Plan truck deliveries and erection", "how": "Spreadsheet", "assumed": true, "rating": "not_covered", "caps": ["cap.api.v1"], "why": "Delivery planning is not covered. Truck loads are counted on the estimate and can be sent to your ERP through the API, which is where Dynamics 365 would own it.", "conf": "likely"},
    {"key": "s8", "area": "procurement", "lane": "Buyer", "name": "Ask cement suppliers for prices", "how": "WhatsApp and email, 3 suppliers", "rating": "standard", "caps": ["cap.module.rfq"], "why": "A request goes to your three suppliers by email, replies come back into BPMSquare, and you award the lowest."},
    {"key": "s9", "area": "procurement", "lane": "Buyer", "name": "Raise purchase order", "how": "ERP", "rating": "standard", "caps": ["cap.module.purchasing"], "why": "Purchase orders and receiving; or keep it in the ERP and push from BPMSquare."},
    {"key": "s10", "area": "workforce", "lane": "Yard supervisor", "name": "Record two-shift attendance and overtime", "how": "Fingerprint machine and Excel", "rating": "needs_setup", "caps": ["cap.module.wfm", "cap.setting.wf_shifts"], "why": "Two shifts, phone or door-tablet punching, overtime approval and a monthly summary. Your admin sets up the sites and shifts."}
  ],
  "changes": [
    {"kind": "new_build", "band": "large", "title": "Approval rule above an amount", "plain": "A quote status that only the GM can move past when the total is above 2M. This is not in the product today; we would discuss whether it belongs in the standard product.", "alt": "Without it: the sales manager watches the amount, as today.", "steps": ["s3"]},
    {"kind": "own_fields", "band": "small", "title": "Tender details on the deal", "plain": "Tender number, bid bond amount and expiry, submission deadline as fields on the deal.", "alt": "", "steps": ["s3", "s4"]},
    {"kind": "extension", "band": "medium", "title": "Your bid cover letter on the quote PDF", "plain": "An extra section on the printed quote in your format, using the existing quote print hook.", "alt": "Without it: the standard quote template, with your logo and terms.", "hook": "quoteExtraSection", "steps": ["s4"]},
    {"kind": "integration", "band": "medium", "title": "Delivery plan to Dynamics 365", "plain": "Send the estimate's truck loads and erection sequence to the ERP when it goes live. The connector exists but has not yet run with a client.", "alt": "Until then: the spreadsheet, exported from the estimate.", "connector": "dynamics365", "steps": ["s7"]},
    {"kind": "new_build", "band": "large", "title": "Casting schedule by mould", "plain": "A new screen: moulds, casting days, capacity per day. Not in the product; we would discuss whether it belongs here or in the ERP.", "alt": "Without it: the whiteboard and spreadsheet, fed by the estimate's quantities.", "steps": ["s6"]}
  ],
  "tasks": [
    {"phase": "foundations", "name": "Workspace, users and roles", "owner": "bpmsquare", "days": 2, "ms": true},
    {"phase": "foundations", "name": "Currency, VAT and your company details", "owner": "client", "days": 1},
    {"phase": "master_data", "name": "Load customers and suppliers from a spreadsheet", "owner": "client", "days": 2},
    {"phase": "master_data", "name": "Product list with components", "owner": "client", "days": 4},
    {"phase": "sales", "name": "Build your estimate template from the Excel sheet", "owner": "bpmsquare", "days": 5},
    {"phase": "sales", "name": "Supplier list and request-for-quotation mailbox", "owner": "bpmsquare", "days": 1},
    {"phase": "sales", "name": "Price three past projects and compare", "owner": "client", "days": 3, "ms": true},
    {"phase": "workforce", "name": "Sites, shifts and leave types", "owner": "client", "days": 2},
    {"phase": "workforce", "name": "Enrol 180 workers; kiosk at the gate", "owner": "bpmsquare", "days": 3},
    {"phase": "workforce", "name": "Parallel run with the fingerprint machine", "owner": "client", "days": 10, "ms": true},
    {"phase": "customisations", "name": "Tender details on the deal", "owner": "bpmsquare", "days": 1},
    {"phase": "customisations", "name": "Your bid cover letter on the quote PDF", "owner": "bpmsquare", "days": 3},
    {"phase": "go_live", "name": "Train estimators, buyers and supervisors", "owner": "bpmsquare", "days": 2},
    {"phase": "go_live", "name": "Go live", "owner": "client", "days": 1, "ms": true}
  ]
}
$j$::jsonb);

    perform pg_temp.ps_seed_sample(t.id, u, $j$
{
  "name": "Hosapete Motor Works (sample)", "weekend": "sun", "start": "2026-11-02",
  "summary": "Motor and transformer repair workshop: rewinding, overhauling and site service. Work comes from OEM referrals, yearly AMC contracts and walk-in customers; 6 technicians go to customer sites.",
  "noticed": ["Your 31 AMC customers from the spreadsheet can be loaded in one go.", "Quotes by WhatsApp are a link to the PDF; the customer does not need an app.", "Reading a WhatsApp message to open a job automatically is not available today; the front office opens the case, which takes under a minute."],
  "chat": [
    {"role": "studio", "text": "Tell us about your business in your own words: what you repair, who sends you work, and how a job goes from the first call to getting paid."},
    {"role": "client", "text": "We rewind and overhaul motors and transformers. Work comes three ways: OEMs refer their customers to us, we hold AMC contracts for yearly servicing, and walk-in customers. A motor comes in, we inspect it, send an inspection report and a quote, repair, test and deliver. Six technicians also visit sites. Attendance is on a register."},
    {"role": "studio", "text": "Thank you. A few questions:", "questions": ["Do OEM referral jobs have a warranty claim you bill to the OEM?", "How does a customer get the inspection report today: email, WhatsApp, printed?", "Do you keep spare parts stock, or buy per job?"],
     "understood": [{"fact": "Motor and transformer repair", "kind": "stated"}, {"fact": "OEM referrals, AMC, direct customers", "kind": "stated"}, {"fact": "Inspection report before quote", "kind": "stated"}, {"fact": "6 field technicians", "kind": "stated"}, {"fact": "Attendance on paper", "kind": "stated"}]},
    {"role": "client", "text": "Yes, warranty jobs are billed to the OEM with their claim number. Reports and quotes go on WhatsApp mostly, sometimes email. We keep copper wire and bearings in stock, the rest per job."}
  ],
  "steps": [
    {"key": "m1", "area": "service", "lane": "Front office", "name": "Receive the motor, open a job", "how": "Register book; OEM referral by phone", "hands": true, "rating": "standard", "caps": ["cap.module.cases", "cap.module.partners", "cap.module.accounts"], "why": "A case is the job from intake to closed; the referring OEM is a partner on it."},
    {"key": "m2", "area": "service", "lane": "Workshop manager", "name": "Inspect and write the inspection report", "how": "Word template, photos on phone", "rating": "standard", "caps": ["cap.module.cases", "cap.object.case"], "why": "The inspection report with photos is part of the case and prints as a PDF."},
    {"key": "m3", "area": "sales", "lane": "Front office", "name": "Send report and quote on WhatsApp", "how": "WhatsApp, sometimes email", "rating": "standard", "caps": ["cap.module.quotations"], "why": "Quotation PDF with a WhatsApp link and email from the case."},
    {"key": "m4", "area": "sales", "lane": "Owner", "name": "Customer approves; warranty jobs billed to the OEM", "how": "Phone; OEM claim number by email", "rating": "partly", "caps": ["cap.module.quotations", "cap.setting.custom_fields"], "why": "The quote records the PO; the OEM claim number needs a field of your own on the case, which an admin can add."},
    {"key": "m5", "area": "service", "lane": "Workshop manager", "name": "Repair, test and deliver", "how": "Job card on paper", "rating": "standard", "caps": ["cap.module.cases", "cap.module.work_orders", "cap.module.invoices"], "why": "Case status from in repair to QA to ready; the work order becomes the invoice."},
    {"key": "m6", "area": "service", "lane": "Technician", "name": "Site visits under AMC contracts", "how": "Yearly schedule in a diary", "rating": "standard", "caps": ["cap.module.amc", "cap.module.dispatch", "cap.module.technicians"], "why": "AMC contracts hold the equipment list and visit schedule; dispatch plans the technicians. Your contracts are loaded once."},
    {"key": "m7", "area": "sales", "lane": "Owner", "name": "AMC renewal reminders", "how": "Memory", "assumed": true, "rating": "standard", "caps": ["cap.module.amc"], "why": "Renewal dates are on the contract and show up on the dashboard.", "conf": "likely"},
    {"key": "m8", "area": "workforce", "lane": "Technician", "name": "Technician attendance and overtime", "how": "Register book", "rating": "needs_setup", "caps": ["cap.module.wfm", "cap.setting.wf_shifts"], "why": "Phone punching with location for technicians on site; overtime approved by the owner. Needs sites and shifts set up."},
    {"key": "m9", "area": "procurement", "lane": "Workshop manager", "name": "Keep copper wire and bearings in stock", "how": "Notebook", "rating": "standard", "caps": ["cap.module.purchasing"], "why": "Inventory for copper wire and bearings; a purchase order when stock runs low."}
  ],
  "changes": [
    {"kind": "own_fields", "band": "small", "title": "OEM claim number on the case", "plain": "A field on the case for the OEM's claim number, printed on the invoice.", "alt": "", "steps": ["m4"]},
    {"kind": "setting", "band": "small", "title": "Your inspection report wording", "plain": "Your report sections and test names as the inspection template.", "alt": "Without it: the standard report, which already covers motors.", "steps": ["m2"]}
  ],
  "tasks": [
    {"phase": "foundations", "name": "Workspace, users and roles", "owner": "bpmsquare", "days": 1, "ms": true},
    {"phase": "foundations", "name": "GST, company details and quotation numbering", "owner": "client", "days": 1},
    {"phase": "master_data", "name": "Load customers, OEM partners and AMC contracts", "owner": "client", "days": 2},
    {"phase": "master_data", "name": "Spare parts list and opening stock", "owner": "client", "days": 1},
    {"phase": "service_production", "name": "Case statuses, inspection template, claim number field", "owner": "bpmsquare", "days": 2},
    {"phase": "service_production", "name": "Run five real jobs through BPMSquare", "owner": "client", "days": 5, "ms": true},
    {"phase": "workforce", "name": "Sites, shifts, technicians' phones", "owner": "client", "days": 1},
    {"phase": "workforce", "name": "Two weeks alongside the register", "owner": "client", "days": 10, "ms": true},
    {"phase": "go_live", "name": "Train front office and workshop manager", "owner": "bpmsquare", "days": 1},
    {"phase": "go_live", "name": "Go live", "owner": "client", "days": 1, "ms": true}
  ]
}
$j$::jsonb);
  end loop;
end $$;
