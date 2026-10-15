import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { loadD365, previewEntity } from "@/lib/connectors/d365/server";
import { D365_ENTITY_KEYS, type D365EntityKey } from "@/lib/connectors/d365/types";

// POST { entity } -- the first five rows as Dynamics returns them, so an
// admin can check field names against the map before the first sync.
// Nothing is written.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let tenantId: string;
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = a.tenantId;
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { entity?: string };
  if (!D365_ENTITY_KEYS.includes(body.entity as D365EntityKey)) return NextResponse.json({ error: "Unknown entity" }, { status: 422 });
  const admin = createAdminSupabase();
  const row = await loadD365(admin, tenantId);
  if (!row) return NextResponse.json({ error: "Save the connection first." }, { status: 400 });
  try {
    return NextResponse.json({ rows: await previewEntity(admin, tenantId, row.cfg, row.creds, body.entity as D365EntityKey) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "Preview failed" }, { status: 400 });
  }
}
