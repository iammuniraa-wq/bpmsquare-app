-- CR-010: GST is optional per quote. When null, no tax row is shown in the Order
-- Summary or PDF (GST @ 18% is instead covered by the Terms & Conditions text);
-- when set, this rate drives the GST line shown in both places.
alter table quotes add column if not exists gst_rate numeric;
