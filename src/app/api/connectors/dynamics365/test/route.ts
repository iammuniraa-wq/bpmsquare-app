import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { loadD365, testConnection, markStatus } from "@/lib/connectors/d365/server";

// POST -- a real, authenticated call against the tenant's Dynamics (admin).
export const maxDuration = 60;

export async function POST() {
  let tenantId: string;
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = a.tenantId;
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 });
  }
  const admin = createAdminSupabase();
  const row = await loadD365(admin, tenantId);
  if (!row) return NextResponse.json({ error: "Save the connection first." }, { status: 400 });
  try {
    const message = await testConnection(admin, tenantId, row.cfg, row.creds);
    await markStatus(admin, tenantId, true);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    const msg = (e as Error).message ?? "Test failed";
    await markStatus(admin, tenantId, false, msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
