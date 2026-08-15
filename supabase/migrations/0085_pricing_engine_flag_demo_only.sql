-- PricingEngine feature flag: demo tenant only (the 0056 staged-rollout
-- pattern). Small Scale Pricing is untouched; a tenant only sees the engine
-- cockpit when this flag is flipped on for them explicitly.

update tenants
set features = coalesce(features, '{}'::jsonb) || '{"pricing_engine": true}'::jsonb
where is_demo = true;

update tenants
set features = coalesce(features, '{}'::jsonb) || '{"pricing_engine": false}'::jsonb
where is_demo is distinct from true
  and not (features ? 'pricing_engine');
