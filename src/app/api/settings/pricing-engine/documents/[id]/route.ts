import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { loadPricingDocument } from "@/lib/pricing/server";

// GET /api/settings/pricing-engine/documents/[id] — one stored pricing
// context with its result and trace. Tenant-scoped in loadPricingDocument.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    const auth = await requireTenantUser();
    const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
    if (!canViewWorkcenter(perms, "pricing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  const document = await loadPricingDocument(tenantId, id);
  if (!document) return NextResponse.json({ error: "Pricing document not found" }, { status: 404 });
  return NextResponse.json({ document });
}
