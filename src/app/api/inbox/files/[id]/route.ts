import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { allowedNovaTypes } from "@/lib/novaAccess";
import { recordFileLink } from "@/lib/inbox/files";
import { errorResponse } from "@/lib/inbox/server";

// GET /api/inbox/files/[id] -> { url, name }: a signed link to a file that was copied onto a Quote, Project, Case, Lead
// or Estimate from an email. Allowed to whoever may open that kind of record (its module and its workcenter); 404 else.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, role } = await requireTenantUser();
    const { id } = await params;
    const admin = createAdminSupabase();
    const link = await recordFileLink(admin, tenantId, id);
    if (!link) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const allowed = await allowedNovaTypes({ supabase, tenantId, userId, role, types: [link.objectType] });
    if (!allowed.has(link.objectType)) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return NextResponse.json({ url: link.url, name: link.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
