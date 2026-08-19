import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { buildAccount360 } from "@/lib/account360/server";
import type { Account360Config } from "@/lib/constants";

/**
 * Nova — Account 360. Everything known about one account in a single
 * payload: internal cards, health rating, suggestions, and the tenant's
 * own plugged-in external sources.
 *
 * Nova-gated like every Next Experience surface (bpmsquarecore §10). The
 * account id comes from the URL, so it's proven against tenant_id inside
 * buildAccount360 before a single related row is read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;

  const { data: tenantRow } = await createAdminSupabase()
    .from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = (tenantRow?.config as { account_360?: Account360Config } | null)?.account_360;

  const payload = await buildAccount360(tenantId, id, config);
  if (!payload) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(payload);
}
