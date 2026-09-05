import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { listPricingDocuments } from "@/lib/pricing/server";
import { PRICING_DOCUMENT_SOURCES, type PricingDocumentSource } from "@/lib/pricing/documents";

// GET /api/settings/pricing-engine/documents?area=&source=&limit=
// Recent stored pricing contexts (spec §7) for the cockpit's "Load a past
// document" and, later, the simulation picker. Summaries only -- the full
// context/trace is GET .../documents/[id].
export async function GET(req: Request) {
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

  const sp = new URL(req.url).searchParams;
  const area = sp.get("area") || undefined;
  const sourceRaw = sp.get("source");
  const source = sourceRaw && (PRICING_DOCUMENT_SOURCES as readonly string[]).includes(sourceRaw)
    ? (sourceRaw as PricingDocumentSource) : undefined;
  const limit = Number(sp.get("limit")) || 50;

  const documents = await listPricingDocuments(tenantId, { area, source, limit });
  return NextResponse.json({ documents });
}
