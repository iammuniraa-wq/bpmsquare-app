-- Found on the cost-based demo walk (2026-09-06): the core gained the
-- PURCHASE cost-input kind in 0113 (a bought-in part's unit cost -- what an
-- RFQ reply is), but the check constraint from 0083 was never widened, so
-- "Save as confirmed cost" on an RFQ failed with
-- pricing_cost_inputs_kind_check. Run AFTER 0113.

alter table pricing_cost_inputs drop constraint if exists pricing_cost_inputs_kind_check;
alter table pricing_cost_inputs add constraint pricing_cost_inputs_kind_check
  check (kind in ('MATERIAL','LABOUR','EQUIPMENT','SALVAGE_CREDIT','OVERHEAD','INDEX','PURCHASE'));
