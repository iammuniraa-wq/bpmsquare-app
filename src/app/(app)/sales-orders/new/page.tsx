import { requireWorkcenterEdit } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, getTenantCurrency, requireFeature } from "@/lib/tenant";
import SalesOrderForm, { type FormType } from "@/components/salesOrders/SalesOrderForm";
import type { PickAccount } from "@/components/salesOrders/lines";
import { standardQuoteProducts } from "../../standard-quotes/formData";

const join = (parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(", ");

export default async function NewSalesOrderPage() {
  await requireWorkcenterEdit("sales_orders");
  await requireFeature("sales_orders");
  const { supabase, tenantId } = await requireTenantUser();
  const tenant = await getTenant();

  const [accounts, contacts, types, products, currency] = await Promise.all([
    supabase.from("accounts").select("id, name, address_line1, address_line2, city, state, postal_code, country").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
    // The types table is created by a hand-applied migration: until then the picker just offers "Automatic".
    supabase.from("sales_order_types").select("id, name, is_default, pricing_mode, active, sort_order").eq("tenant_id", tenantId).eq("active", true).order("sort_order"),
    standardQuoteProducts(supabase, tenantId, tenant),
    getTenantCurrency(),
  ]);

  const pickAccounts: PickAccount[] = (accounts.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    address: join([a.address_line1 as string | null, a.address_line2 as string | null, a.city as string | null, a.state as string | null, a.postal_code as string | null, a.country as string | null]),
  }));
  const formTypes: FormType[] = types.error ? [] : (types.data ?? []).map((t) => ({
    id: t.id as string, name: t.name as string, is_default: t.is_default === true, pricing_mode: t.pricing_mode === "external" ? "external" : "internal",
  }));

  return (
    <SalesOrderForm
      accounts={pickAccounts}
      contacts={(contacts.data ?? []) as { id: string; name: string; account_id: string }[]}
      types={formTypes}
      products={products}
      currency={currency.code}
    />
  );
}
