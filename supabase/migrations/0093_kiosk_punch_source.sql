-- 0093: allow 'kiosk_face' as a presence-event source.
--
-- Kiosk punches (face-identified on the registered door tablet) must be
-- distinguishable from phone selfie punches in the audit trail — reusing
-- 'web_selfie' would hide which surface recorded the event. 0062 predicted
-- this exact widening ("extensible later: kiosk | ...").
--
-- Drop-then-add in this order, in one transaction: the ADD validates
-- existing rows, all of which use the original three values, so this is
-- safe on live data.

alter table wfm_presence_events
  drop constraint wfm_presence_events_source_check;

alter table wfm_presence_events
  add constraint wfm_presence_events_source_check
  check (source in ('web_selfie', 'manual_admin', 'correction', 'kiosk_face'));
