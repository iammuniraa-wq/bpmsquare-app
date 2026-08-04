-- 0060_new_feature_flags_vikas.sql
-- Rollout to the real Vikas Pioneers tenant: same six flags 0056 turned on
-- for the demo tenant, now enabled for the client after testing on demo.
-- Same jsonb `||` merge -- only these six keys are touched, everything else
-- in the tenant's features column keeps its current value. Targets the
-- client tenant by slug ('vikas-pioneers'); the demo tenant ('vikas',
-- is_demo = true) was already enabled by 0056 and is unaffected here.
--
-- Note: gmail_reply_threading additionally needs the tenant to connect a
-- Gmail App Password in Settings -> Connectors before it does anything, and
-- the AI features under standard_quotes need ANTHROPIC_API_KEY set on the
-- deployment -- the flags only make the features available.

update tenants
set features = features || '{
  "change_history": true,
  "outbound_email": true,
  "business_roles": true,
  "standard_quotes": true,
  "gmail_reply_threading": true,
  "quote_lines_dw": true
}'::jsonb
where slug = 'vikas-pioneers';
