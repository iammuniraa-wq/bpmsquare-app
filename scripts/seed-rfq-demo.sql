-- Sample RFQs for the DEMO tenant (run AFTER supabase/migrations/0128_rfq.sql).
-- Idempotent: skips an RFQ whose title already exists for the tenant.
-- Needs at least two suppliers on the demo tenant (Master data -> Suppliers);
-- with fewer, the RFQs are created without suppliers and nothing else breaks.
--
-- What it shows on the demo:
--   RFQ "Bearings and seals for motor overhaul"  -- sent to two suppliers,
--       one replied with prices (one line quoted in USD), one still waiting:
--       the comparison grid has something to compare and award.
--   RFQ "Control panel enclosure, IP65"          -- a draft with no suppliers
--       yet, to show the create/send flow.
-- Also turns the rfq feature on for the demo tenant only.

do $$
declare
  t uuid;
  s1 uuid;
  s2 uuid;
  r1 uuid;
  r2 uuid;
  l1 uuid;
  l2 uuid;
  rs1 uuid;
  rs2 uuid;
  next_seq int;
begin
  select id into t from tenants where is_demo = true limit 1;
  if t is null then
    raise notice 'No demo tenant -- nothing seeded';
    return;
  end if;

  select id into s1 from suppliers where tenant_id = t and status = 'active' order by name limit 1;
  select id into s2 from suppliers where tenant_id = t and status = 'active' and id <> coalesce(s1, '00000000-0000-0000-0000-000000000000') order by name limit 1;

  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) + 1 into next_seq
  from (select ref from rfqs where tenant_id = t union all select ref from pricing_rfqs where tenant_id = t) x
  where ref ~ '^RFQ-\d+$';

  if not exists (select 1 from rfqs where tenant_id = t and title = 'Bearings and seals for motor overhaul') then
    insert into rfqs (tenant_id, ref, title, status, origin_type, respond_by, required_by, delivery_terms, notes_to_supplier, created_at)
    values (t, 'RFQ-' || lpad(next_seq::text, 4, '0'), 'Bearings and seals for motor overhaul', 'partially_replied', 'manual',
            current_date + 3, current_date + 21, 'DAP our workshop', 'Original make preferred; quote equivalents as alternatives.', now() - interval '2 days')
    returning id into r1;
    next_seq := next_seq + 1;

    insert into rfq_lines (tenant_id, rfq_id, sl_no, description, spec, uom, qty)
    values (t, r1, 1, 'Deep groove ball bearing 6312-2Z/C3', 'SKF or equivalent, C3 clearance', 'Nos', 4)
    returning id into l1;
    insert into rfq_lines (tenant_id, rfq_id, sl_no, description, spec, uom, qty)
    values (t, r1, 2, 'Shaft oil seal 75x100x10', 'Viton, double lip', 'Nos', 8)
    returning id into l2;

    if s1 is not null then
      insert into rfq_suppliers (tenant_id, rfq_id, supplier_id, email_to, status, sent_at, viewed_at, replied_at, currency, valid_until, reply_source, supplier_quote_ref)
      select t, r1, s1, s.email, 'replied', now() - interval '2 days', now() - interval '1 day', now() - interval '20 hours', 'USD', current_date + 30, 'link', 'Q-2291'
      from suppliers s where s.id = s1
      returning id into rs1;
      insert into rfq_responses (tenant_id, rfq_supplier_id, rfq_line_id, status, unit_price, currency, lead_time_days, moq, source)
      values (t, rs1, l1, 'quoted', 42.50, 'USD', 10, 2, 'link'),
             (t, rs1, l2, 'quoted', 6.80, 'USD', 7, 10, 'link');
      insert into rfq_messages (tenant_id, rfq_id, rfq_supplier_id, direction, channel, subject, body_text, status, created_at)
      values (t, r1, rs1, 'in', 'portal', 'Prices submitted', '2 line(s) priced' || chr(10) || chr(10) || 'Seals ship in boxes of 10.', 'received', now() - interval '20 hours');
    end if;

    if s2 is not null then
      insert into rfq_suppliers (tenant_id, rfq_id, supplier_id, email_to, status, sent_at)
      select t, r1, s2, s.email, 'sent', now() - interval '2 days'
      from suppliers s where s.id = s2
      returning id into rs2;
    end if;
  end if;

  if not exists (select 1 from rfqs where tenant_id = t and title = 'Control panel enclosure, IP65') then
    insert into rfqs (tenant_id, ref, title, status, origin_type, respond_by, notes_internal)
    values (t, 'RFQ-' || lpad(next_seq::text, 4, '0'), 'Control panel enclosure, IP65', 'draft', 'manual', current_date + 5, 'Drawing CP-14 attached to the case.')
    returning id into r2;
    insert into rfq_lines (tenant_id, rfq_id, sl_no, description, spec, uom, qty)
    values (t, r2, 1, 'Wall-mount enclosure 800x600x300', 'IP65, powder-coated RAL 7035, gland plate', 'Nos', 2);
  end if;

  update tenants set features = coalesce(features, '{}'::jsonb) || '{"rfq": true}'::jsonb where id = t;
end $$;
