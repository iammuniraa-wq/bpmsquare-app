-- scripts/seed-site-demo.sql
-- Demo data for Site receipt and Site expenses (docs/design/pcbs-site-receipt-expenses.md). Run AFTER migrations 0258 and 0259
-- (bundles site-0258 and site-0259). Idempotent: safe to run twice. It touches ONLY workspaces flagged is_demo = true; a real client
-- workspace (PCBS, BIM, Vikas) is never changed. The owner switches the two flags on for PCBS by hand in /admin/tenants.
--
-- 1. Turns on contract_projects (the modules need it), site_receipts and site_expenses for every demo workspace.
-- 2. Seeds the six expense categories for each of them.
-- 3. Where a demo workspace has an ACTIVE contract project and a member, adds three sample expenses and one sample receipt on it,
--    prefixed ZDEMO so they are easy to find and remove by hand (nothing is deleted here).

do $$
begin
  if to_regclass('public.site_expenses') is null or to_regclass('public.site_receipts') is null then
    raise exception 'Run migrations 0258 and 0259 first (bundles site-0258 and site-0259), then run this again.';
  end if;
end $$;

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"contract_projects": true, "site_receipts": true, "site_expenses": true}'::jsonb
 where is_demo = true;

insert into site_expense_categories (tenant_id, name, resource_code, erp_category, sort_order)
select t.id, c.name, c.resource_code, c.resource_code, c.sort_order
  from tenants t
  cross join (values ('Materials', '11', 0), ('Equipment rental', '21', 1), ('Manpower', '31', 2), ('Subcontractor', '41', 3), ('Transport', '51', 4), ('Other', '51', 5)) as c(name, resource_code, sort_order)
 where t.is_demo = true
on conflict (tenant_id, name) do nothing;

-- Sample records on the first active project of each demo workspace.
do $$
declare
  t record;
  p record;
  u uuid;
  cat uuid;
  n int;
  rid uuid;
begin
  for t in select id from tenants where is_demo = true loop
    select id, currency into p from contract_projects where tenant_id = t.id and status = 'active' order by created_at limit 1;
    select user_id into u from tenant_users where tenant_id = t.id order by created_at limit 1;
    if p.id is null or u is null then continue; end if;
    select id into cat from site_expense_categories where tenant_id = t.id and lower(name) = 'equipment rental';

    -- three expenses: waiting, approved, returned
    for n in 1..3 loop
      if not exists (select 1 from site_expenses where tenant_id = t.id and client_id = md5('zdemo-expense-' || t.id::text || n)::uuid) then
        insert into site_expenses (tenant_id, ref, project_id, client_id, status, category_id, expense_date, amount, currency, amount_project_ccy, vendor_text, document_state, paid_by, note, submitted_by, approved_by, approved_at, reject_reason)
        values (
          t.id,
          'SEX-' || lpad((coalesce((select max(substring(ref from 5)::int) from site_expenses where tenant_id = t.id and ref ~ '^SEX-\d+$'), 0) + 1)::text, 4, '0'),
          p.id, md5('zdemo-expense-' || t.id::text || n)::uuid,
          (array['submitted', 'approved', 'rejected'])[n], cat, current_date - n,
          (array[412.85, 180.00, 2860.00])[n], coalesce(p.currency, 'SAR'), (array[412.85, 180.00, 2860.00])[n],
          (array['ZDEMO Eastern Crane Rental', 'ZDEMO Al Rashid Fuel', 'ZDEMO Gulf Scaffold Co.'])[n], 'invoice_to_follow', 'company', 'Demo record',
          u, case when n = 2 then u else null end, case when n = 2 then now() else null end, case when n = 3 then 'Please attach the invoice number' else null end
        );
      end if;
    end loop;

    -- one receipt with one short item
    if not exists (select 1 from site_receipts where tenant_id = t.id and client_id = md5('zdemo-receipt-' || t.id::text)::uuid) then
      insert into site_receipts (tenant_id, ref, project_id, client_id, status, delivery_note_ref, source_type, received_at, received_by, handed_by, vehicle, outcome, note)
      values (
        t.id,
        'SRC-' || lpad((coalesce((select max(substring(ref from 5)::int) from site_receipts where tenant_id = t.id and ref ~ '^SRC-\d+$'), 0) + 1)::text, 4, '0'),
        p.id, md5('zdemo-receipt-' || t.id::text)::uuid, 'confirmed', 'ZDEMO DN-24817', 'manual', now() - interval '1 day', u, 'Faisal', 'Truck 4417', 'partial', 'Demo record'
      ) returning id into rid;
      insert into site_receipt_lines (tenant_id, receipt_id, line_no, element_code, description, uom, qty_expected, qty_received, qty_accepted, qty_rejected, condition, reason_code)
      values (t.id, rid, 1, 'HCS-B2-014', 'Hollow-core slab', 'pcs', 8, 8, 8, 0, 'ok', null),
             (t.id, rid, 2, 'BM-B2-003', 'Beam', 'pcs', 2, 1, 1, 0, 'ok', 'not_delivered');
    end if;
  end loop;
end $$;
