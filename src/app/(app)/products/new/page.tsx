import { requireTenantUser } from "@/lib/supabase-server";
import { supplierPickerOptions } from "@/lib/products/supplier";
import NewProductForm from "./NewProductForm";

export default async function NewProductPage() {
  const { supabase, tenantId } = await requireTenantUser();
  const suppliers = await supplierPickerOptions(supabase, tenantId);
  return <NewProductForm suppliers={suppliers} />;
}
