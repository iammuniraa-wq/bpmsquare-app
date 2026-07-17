import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import InventoryForm from "./InventoryForm";

export default async function NewInventoryItemPage() {
  await requireFeature("purchasing");
  const { supabase, tenantId } = await requireTenantUser();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("name");

  return <InventoryForm suppliers={suppliers ?? []} />;
}
