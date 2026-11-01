import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantHasFeature } from "@/lib/tenant";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import type { BoqCtx } from "@/lib/tender/boq/server";

// The rest of the gate for the three Tender BOQ lines Data Workbench routes (the module flag is asserted in each route, literally,
// because objectFeatures.test.ts reads it there). Same order as openBoqRequest: the edition needs the Pipeline too (404, the module is
// simply not there), then the caller's view of the Pipeline for Export, or edit for Import and Update (403 either way, as the other
// Data Workbench objects answer). The per-tender checks (the deal is a tender of THIS workspace) are boqRequestFor's, called once per tender by the route.
export async function boqDwGate(
  supabase: SupabaseClient, tenantId: string, userId: string, role: "admin" | "member", mode: "view" | "edit",
): Promise<{ ok: true; ctx: BoqCtx } | { ok: false; response: NextResponse }> {
  if (!(await tenantHasFeature(supabase, tenantId, "pipeline"))) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "pipeline")) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (mode === "edit" && !canEditWorkcenter(perms, "pipeline")) {
    return { ok: false, response: NextResponse.json({ error: "You can view tenders but not change them" }, { status: 403 }) };
  }
  return { ok: true, ctx: { supabase, tenantId, userId, role, perms } };
}
