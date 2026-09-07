// Converts a saved fence project into a real Standard Quote (Phase D
// wired up, docs/fence-configurator-architecture.md §8). Re-derives
// geometry/BOM server-side from the project's OWN saved inputs plus its
// chosen security profile's CURRENT numbers (spacing/embedment/pipe_class
// aren't snapshotted onto the project -- profiles are shared, tunable
// tenant presets per owner decision #2, not a frozen copy per project).

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { computeGeometry } from "@/lib/fence/geometry";
import { computeBom, type FenceAccessories } from "@/lib/fence/bom";
import { buildMaterialRequests } from "@/lib/fence/materialMatch";
import { resolveFenceMaterials } from "@/lib/fence/materials";
import { assembleFenceStandardQuote, FenceQuoteError } from "@/lib/fence/quoteAssembly";

const DEFAULT_ACCESSORIES: FenceAccessories = { truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: false };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: project } = await supabase.from("fence_projects").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!project.account_id) return NextResponse.json({ error: "Add an account to this project before converting it to a quote." }, { status: 400 });
  if (!project.security_profile_id) return NextResponse.json({ error: "Choose a security profile before converting it to a quote." }, { status: 400 });

  const { data: profile } = await supabase
    .from("fence_security_profiles")
    .select("post_spacing_m, embedment_m, pipe_class")
    .eq("id", project.security_profile_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "This project's security profile no longer exists -- choose another." }, { status: 400 });

  const { data: gateRows } = await supabase.from("fence_gates").select("gate_type, width_m").eq("fence_project_id", id).eq("tenant_id", tenantId);
  const gates = (gateRows ?? []).map((g) => ({ type: g.gate_type as "single_swing" | "double_swing" | "sliding", width_m: g.width_m as number }));

  const customData = (project.custom_data ?? {}) as { straining_spacing_m?: number; accessories?: FenceAccessories };
  const straining_spacing_m = customData.straining_spacing_m ?? 100;
  const accessories = customData.accessories ?? DEFAULT_ACCESSORIES;

  const geometry = computeGeometry({
    layout: project.layout,
    total_length_m: project.total_length_m,
    post_spacing_m: profile.post_spacing_m,
    embedment_m: profile.embedment_m,
    straining_spacing_m,
    gates,
    fabric_height_m: project.fabric_height_m,
  });
  const bom = computeBom({ geometry, fabric_height_m: project.fabric_height_m, total_length_m: project.total_length_m, accessories });
  const requests = buildMaterialRequests(geometry, bom);
  const resolved = await resolveFenceMaterials(tenantId, requests, {
    pipe_class: profile.pipe_class,
    mesh_spec: project.mesh_spec ?? "",
    coating: project.coating ?? "",
  });

  try {
    const result = await assembleFenceStandardQuote(tenantId, {
      accountId: project.account_id,
      contactId: project.contact_id,
      createdBy: userId,
      lines: resolved,
    });

    await supabase
      .from("fence_projects")
      .update({ standard_quote_id: result.quoteId, status: "quoted", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof FenceQuoteError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
