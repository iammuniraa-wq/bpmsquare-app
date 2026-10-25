import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { loadErpOrgCodes } from "@/lib/middleware/erpOrgCodes";

// GET -> { codes: { "segment:<id>" | "order_type:<id>": [{ kind, label, connection, code }] } }
// The sales area / ERP company codes the Mapping tab holds, for the read-only chips on Settings > Coverage and Settings > Order types.
// Admin only (the screens it feeds are), tenant from the session, every list read with the tenant filter.
export async function GET() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ codes: await loadErpOrgCodes(createAdminSupabase(), tenantId) });
}
