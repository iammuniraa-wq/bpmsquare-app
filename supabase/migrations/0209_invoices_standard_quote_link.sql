-- 0209_invoices_standard_quote_link.sql
--
-- Standard Quote -> Invoice. The Quotation convert route links its invoice through invoices.quote_id; a
-- Standard Quote is a different table, so the invoice it produces needs its own nullable link. It is what
-- lets a second "Create invoice" answer 409 with the existing invoice instead of billing the quote twice.
--
-- Additive and nullable: no existing invoice changes. No policy change either: invoices already has its
-- tenant-isolation policies (0000_baseline). Idempotent; runs only if both tables exist. Until it is applied
-- the app still creates the invoice (it keeps the link in custom_data instead), so nothing breaks while this
-- is pending.

do $$ begin
  if to_regclass('public.invoices') is null or to_regclass('public.standard_quotes') is null then
    return;
  end if;
  execute 'alter table invoices add column if not exists standard_quote_id uuid references standard_quotes(id) on delete set null';
  execute 'create index if not exists invoices_standard_quote_idx on invoices (tenant_id, standard_quote_id) where standard_quote_id is not null';
end $$;
