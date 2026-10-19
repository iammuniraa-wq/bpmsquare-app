import { requireTenantUser } from "@/lib/supabase-server";
import { supplierPickerOptions } from "@/lib/products/supplier";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";
import { selectableItemTypes } from "@/lib/products/itemTypes";
import NewProductForm from "./NewProductForm";

export default async function NewProductPage() {
  const { supabase, tenantId } = await requireTenantUser();
  const suppliers = await supplierPickerOptions(supabase, tenantId);
  const itemTypes = selectableItemTypes(await getTenantItemTypeConfig(supabase, tenantId)).map((x) => ({ key: x.key, label: x.label }));
  return <NewProductForm suppliers={suppliers} itemTypes={itemTypes} />;
}
