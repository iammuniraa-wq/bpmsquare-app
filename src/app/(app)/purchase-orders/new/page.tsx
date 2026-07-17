import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import PurchaseOrderForm from "./PurchaseOrderForm";

export default async function NewPurchaseOrderPage() {
  await requireFeature("purchasing");
  const { supabase, tenantId } = await requireTenantUser();

  const [{ data: suppliers }, { data: quotes }, { data: cases }, { data: items }] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("tenant_id", tenantId).eq("status", "active").order("name"),
    supabase.from("quotes").select("id, ref").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
    supabase.from("service_cases").select("id, ref").eq("tenant_id", tenantId).order("intake_at", { ascending: false }).limit(100),
    supabase.from("inventory_items").select("id, sku, name, uom, unit_cost").eq("tenant_id", tenantId).eq("status", "active").order("name"),
  ]);

  return (
    <PurchaseOrderForm
      suppliers={suppliers ?? []}
      quotes={quotes ?? []}
      cases={cases ?? []}
      items={items ?? []}
    />
  );
}
