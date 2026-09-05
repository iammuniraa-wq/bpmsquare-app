-- BIM: clear the leave TEST data recorded while the generic leave types were
-- being tried out (owner request 2026-09-06), then drop the generic types.
--
-- Run 0109_wfm_leave_type_limits.sql first. Run this in TWO passes: the
-- inspection block alone, read the counts, then the delete block. Every
-- statement is scoped to the BIM tenant by slug; nothing here touches any
-- other tenant. Leave records are the only WFM data this removes -- punches,
-- overtime and corrections are untouched.
--
-- Adjust GENERIC_TYPES to the exact names the client wants gone. The types
-- they keep (CompOff, Sick) are left alone; only their leave HISTORY is
-- cleared by the optional step 3.

-- ── 1. Inspection: what exists today ───────────────────────────────────────
with t as (select id from tenants where slug = 'bim')
select lt.name, lt.category, lt.active,
       (select count(*) from wfm_leave_records r where r.tenant_id = lt.tenant_id and r.leave_type_id = lt.id)  as records,
       (select count(*) from wfm_leave_requests q where q.tenant_id = lt.tenant_id and q.leave_type_id = lt.id) as requests,
       (select count(*) from wfm_leave_quotas  k where k.tenant_id = lt.tenant_id and k.leave_type_id = lt.id and k.employee_id is not null) as employee_quotas
  from wfm_leave_types lt
 where lt.tenant_id = (select id from t)
 order by lt.name;

-- ── 2. Remove the generic types and everything recorded under them ─────────
-- Names are matched case-insensitively. Requests go first (they point at
-- records), then records, then quotas, then the types.
/*
do $$
declare
  v_tenant uuid := (select id from tenants where slug = 'bim');
  generic_types text[] := array['Paid Leave', 'Unpaid Leave'];   -- <- the crossed-out ones
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
    from wfm_leave_types
   where tenant_id = v_tenant and lower(name) = any (select lower(unnest(generic_types)));
  if v_ids is null then
    raise notice 'no generic types found for tenant %', v_tenant;
    return;
  end if;
  delete from wfm_leave_requests where tenant_id = v_tenant and leave_type_id = any (v_ids);
  delete from wfm_leave_records  where tenant_id = v_tenant and leave_type_id = any (v_ids);
  delete from wfm_leave_quotas   where tenant_id = v_tenant and leave_type_id = any (v_ids);
  delete from wfm_leave_types    where tenant_id = v_tenant and id = any (v_ids);
  raise notice 'removed % generic leave type(s) and their history for tenant %', array_length(v_ids, 1), v_tenant;
end $$;
*/

-- ── 3. Optional: also clear TEST leave history under the types they keep ───
-- Only if the CompOff / Sick entries so far were test entries too. Balances
-- start fresh from the annual quota; nothing else changes.
/*
do $$
declare
  v_tenant uuid := (select id from tenants where slug = 'bim');
begin
  delete from wfm_leave_requests where tenant_id = v_tenant;
  delete from wfm_leave_records  where tenant_id = v_tenant;
  raise notice 'cleared all leave requests and records for tenant %', v_tenant;
end $$;
*/

-- ── 4. The client's policy on the types they keep (or set it in Settings →
--       Workforce → Leave Types, which does the same thing) ─────────────────
/*
update wfm_leave_types set monthly_limit = 1
 where tenant_id = (select id from tenants where slug = 'bim') and lower(name) = 'compoff';
update wfm_leave_types set paid_days_per_month = 1
 where tenant_id = (select id from tenants where slug = 'bim') and lower(name) = 'sick';
*/
