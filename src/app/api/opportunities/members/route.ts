import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";

// Colleagues for the deal owner / team pickers -- names and emails only,
// any member may read (the settings team list is admin-only because it
// carries roles and invitations; this carries neither).
export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "pipeline"))) {
    return NextResponse.json({ error: "Pipeline isn't enabled for your workspace" }, { status: 403 });
  }
  return NextResponse.json(await listMembersForPicker(createAdminSupabase(), tenantId));
}
