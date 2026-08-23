import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature, getTenant } from "@/lib/tenant";
import { getNovaStreamItems } from "@/lib/nova/stream";
import { getNovaFlows } from "@/lib/nova/flows";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef, type TenantFeatures } from "@/lib/constants";

/**
 * GET /api/nova/nav -- the data behind Nova's left rail (Needs You Now +
 * Flows). Self-fetched by NovaSidebar.tsx once on mount, same pattern as
 * NovaInbox/NovaPalette, rather than prop-drilled through Shell/layout.tsx.
 * Gated on next_experience like every other Nova-only surface (flow-board,
 * comments, draft) -- a tenant without the flag gets a plain 403, not data.
 */
export async function GET() {
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

  const tenant = await getTenant();
  const features = (tenant?.features ?? {}) as TenantFeatures;
  const quoteStatuses: QuoteStatusDef[] = tenant?.config?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;

  const [items, flows] = await Promise.all([
    getNovaStreamItems(tenantId),
    getNovaFlows(tenantId, features, quoteStatuses),
  ]);

  return NextResponse.json({ items, flows });
}
