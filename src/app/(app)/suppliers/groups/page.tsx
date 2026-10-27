import { notFound } from "next/navigation";
import { getTenant, requireFeature } from "@/lib/tenant";
import { canEditWorkcenter, requireWorkcenterView, resolvePermissions } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Tabs from "@/components/ui/Tabs";
import GroupsClient from "@/components/suppliers/GroupsClient";

/**
 * Supplier groups: a client's approved suppliers (docs/design/contract-buyout.md). A second view of the Suppliers screen, in its own tab
 * strip. Only a workspace with the tender edition has it, because that is where a client's list narrows who can be asked for a price.
 * The groups themselves are read by the view from /api/supplier-groups; the page only supplies the suppliers and clients to pick from.
 */
export default async function SupplierGroupsPage() {
  await requireWorkcenterView("suppliers");
  await requireFeature("suppliers");
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const tenant = await getTenant();
  if (tenant?.features?.gcc_tender !== true) notFound();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const [suppliers, accounts] = await Promise.all([
    supabase.from("suppliers").select("id, name, type, city, status").eq("tenant_id", tenantId).order("name"),
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name").limit(2000),
  ]);

  return (
    <>
      <TabTitle title="Supplier groups" />
      <PageHeader title="Suppliers" subtitle="Groups" />
      <div style={{ marginBottom: 14 }}>
        <Tabs
          label="Suppliers views" value="groups"
          tabs={[{ id: "suppliers", label: "Suppliers" }, { id: "groups", label: "Groups" }]}
          hrefFor={(id) => (id === "groups" ? ROUTES.supplierGroups : ROUTES.suppliers)}
        />
      </div>
      <GroupsClient
        suppliers={(suppliers.data ?? []) as { id: string; name: string; type: string | null; city: string | null; status: string }[]}
        accounts={(accounts.data ?? []) as { id: string; name: string }[]}
        canEdit={canEditWorkcenter(perms, "suppliers")}
      />
    </>
  );
}
