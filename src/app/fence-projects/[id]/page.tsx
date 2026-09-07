import { notFound } from "next/navigation";
import { getTenant, requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { getFenceSecurityProfiles } from "@/lib/fence/data";
import { getFenceProductCatalog } from "@/lib/fence/materials";
import FenceConfigurator, { type FenceProjectSnapshot } from "@/components/fence/FenceConfigurator";
import type { FenceAccessories } from "@/lib/fence/bom";
import type { FenceGate, FenceProject } from "@/lib/types";

export default async function FenceProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("fence_projects");
  await requireFeature("fence_projects");
  const { id } = await params;
  const tenant = await getTenant();
  const tenantId = tenant!.id;
  const { supabase } = await requireTenantUser();

  const [{ data: row }, { data: gateRows }, profiles, catalog, { data: accountRows }, { data: contactRows }] = await Promise.all([
    supabase.from("fence_projects").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("fence_gates").select("*").eq("fence_project_id", id).eq("tenant_id", tenantId).order("created_at"),
    getFenceSecurityProfiles(tenantId),
    getFenceProductCatalog(tenantId),
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
  ]);

  if (!row) notFound();
  const project = row as FenceProject;
  const gates = (gateRows ?? []) as FenceGate[];
  const customData = (project.custom_data ?? {}) as { straining_spacing_m?: number; accessories?: FenceAccessories };

  const snapshot: FenceProjectSnapshot = {
    id: project.id,
    ref: project.ref,
    name: project.name,
    status: project.status,
    standardQuoteId: project.standard_quote_id,
    accountId: project.account_id,
    contactId: project.contact_id,
    securityProfileId: project.security_profile_id,
    layout: project.layout,
    totalLength: project.total_length_m,
    fabricHeight: project.fabric_height_m,
    meshSpec: project.mesh_spec,
    coating: project.coating ?? "PVC coated",
    gates: gates.map((g) => ({ type: g.gate_type, width_m: g.width_m })),
    strainingSpacing: customData.straining_spacing_m ?? 100,
    accessories: customData.accessories ?? { truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: false },
  };

  return (
    <FenceConfigurator
      profiles={profiles}
      catalog={catalog}
      accounts={accountRows ?? []}
      contacts={contactRows ?? []}
      project={snapshot}
    />
  );
}
