-- Seed test service cases for the Vikas Pioneers tenant.
-- Run this in the Supabase SQL editor.
-- Uses subqueries so you don't need to hardcode IDs.

do $$
declare
  v_tenant_id  uuid;
  v_account_id uuid;
  v_tech_id    uuid;
begin

  -- Resolve tenant
  select id into v_tenant_id from tenants limit 1;
  if v_tenant_id is null then
    raise exception 'No tenant found — run tenant onboarding first';
  end if;

  -- Resolve any account
  select id into v_account_id from accounts where tenant_id = v_tenant_id limit 1;
  if v_account_id is null then
    raise exception 'No accounts found — create at least one account first';
  end if;

  -- Resolve any active technician (optional)
  select id into v_tech_id from technicians where tenant_id = v_tenant_id and status = 'active' limit 1;

  -- Insert test cases (skip if ref already exists)
  insert into service_cases
    (tenant_id, account_id, ref, type, status, equipment_label, complaint,
     assigned_to, intake_at, has_loaner)
  values
    (v_tenant_id, v_account_id, 'CS-2026-0001', 'adhoc', 'inspection',
     'Crompton 75 kW 3-Ph Induction Motor · CG-75-2291',
     'Motor running hot, vibration noise at startup. Customer reports intermittent tripping on overload relay.',
     v_tech_id, now() - interval '5 days', false),

    (v_tenant_id, v_account_id, 'CS-2026-0002', 'direct', 'in_repair',
     'ABB 22 kW Transformer · ABB-T22-0043',
     'Burnt smell noticed during operation. Insulation resistance test failed on HV winding.',
     v_tech_id, now() - interval '10 days', false),

    (v_tenant_id, v_account_id, 'CS-2026-0003', 'adhoc', 'intake',
     'Kirloskar 37 kW Pump Motor · KP-37-1182',
     'Motor not starting — trips immediately on switch-on. Bearings may have seized.',
     null, now() - interval '1 day', false),

    (v_tenant_id, v_account_id, 'CS-2026-0004', 'amc', 'report_sent',
     'Siemens 110 kW HV Motor · SIE-110-0019',
     'Scheduled AMC inspection. Found worn brush gear and minor winding fault on phase B.',
     v_tech_id, now() - interval '14 days', false),

    (v_tenant_id, v_account_id, 'CS-2026-0005', 'direct', 'closed',
     'WEG 15 kW Single-Phase Motor · WEG-15-SP-0077',
     'Capacitor failure causing motor to stall at rated load. Replaced start/run capacitors.',
     v_tech_id, now() - interval '20 days', false)
  -- Guard: skip if these refs already exist for this tenant
  -- (no unique constraint — filter manually)
  where not exists (
    select 1 from service_cases sc2
    where sc2.tenant_id = v_tenant_id
      and sc2.ref in ('CS-2026-0001','CS-2026-0002','CS-2026-0003','CS-2026-0004','CS-2026-0005')
  );

  raise notice 'Seed cases inserted for tenant %', v_tenant_id;
end $$;
