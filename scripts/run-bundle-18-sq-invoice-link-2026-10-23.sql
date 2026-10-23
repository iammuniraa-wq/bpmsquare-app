-- run-bundle-18-sq-invoice-link-2026-10-23.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). No seed.
-- = migration 0209 (invoices.standard_quote_id, so a Standard Quote can be turned into an invoice once). Safe to run twice.
-- The app works before and after this: until it is applied the link is kept in the invoice's custom_data.


-- 0209_invoices_standard_quote_link.sql
do $$ begin
  if to_regclass('public.invoices') is null or to_regclass('public.standard_quotes') is null then
    return;
  end if;
  execute 'alter table invoices add column if not exists standard_quote_id uuid references standard_quotes(id) on delete set null';
  execute 'create index if not exists invoices_standard_quote_idx on invoices (tenant_id, standard_quote_id) where standard_quote_id is not null';
end $$;
