-- Mapping engine: sample value lists (Unit and Currency) for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0203_mapping_engine.sql.
-- Idempotent. Touches ONLY tenants where is_demo = true; never a client.
--
-- The lists belong to the Dynamics 365 connection ('dynamics365'). A second run adds nothing: a list that exists is left
-- exactly as the person edited it. `Mtr` and `Metre` share the code M; Mtr is the answer when M comes back (inbound).
-- `Box` has no ERP code on purpose: awarding a quote with a line in Box fails in the Monitor with the exact fix, which
-- is the demo of "an unmapped value is never sent silently".

insert into integration_value_lists (tenant_id, connection_id, kind, label, rows, default_in)
select t.id, 'dynamics365', 'unit', 'Unit',
       '[{"bpm":"Nos","erp":"EA","inbound":true},
         {"bpm":"Mtr","erp":"M","inbound":true},
         {"bpm":"Metre","erp":"M","inbound":false},
         {"bpm":"Kg","erp":"KG","inbound":true},
         {"bpm":"Ltr","erp":"L","inbound":true},
         {"bpm":"Set","erp":"SET","inbound":true},
         {"bpm":"Box","erp":"","inbound":false}]'::jsonb,
       'Nos'
  from tenants t
 where t.is_demo = true
on conflict (tenant_id, connection_id, kind) do nothing;

insert into integration_value_lists (tenant_id, connection_id, kind, label, rows, default_in)
select t.id, 'dynamics365', 'currency', 'Currency',
       '[{"bpm":"INR","erp":"INR","inbound":true},
         {"bpm":"USD","erp":"USD","inbound":true},
         {"bpm":"AED","erp":"AED","inbound":true}]'::jsonb,
       null
  from tenants t
 where t.is_demo = true
on conflict (tenant_id, connection_id, kind) do nothing;
