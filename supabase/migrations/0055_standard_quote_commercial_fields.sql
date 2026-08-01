-- 0055_standard_quote_commercial_fields.sql
-- Header-level commercial fields Standard Quote was missing vs. a real
-- commercial quote (Salesforce/HubSpot both have these): a header discount,
-- a single tax rate, and shipping/handling. Applied in that order --
-- taxable value = subtotal - header discount; tax is computed on the taxable
-- value; shipping is added untaxed after tax. Still no per-line tax, no
-- multi-tax-rate/bundle pricing engine -- that's the separately deferred
-- "full pricing solution" roadmap item.
--
-- intro_text is a per-quote override of the template's intro_text block
-- content (see 0054_standard_quote_templates.sql) -- a template's own
-- intro_text is static branding copy shared by every quote using it; this
-- lets one quote (e.g. an AI-drafted, account-specific paragraph) override
-- that for itself without touching the template.

alter table standard_quotes
  add column header_discount_pct numeric(5,2) not null default 0,
  add column tax_pct             numeric(5,2) not null default 0,
  add column shipping_amount     numeric(12,2) not null default 0,
  add column intro_text          text;
