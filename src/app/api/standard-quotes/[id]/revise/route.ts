import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { reviseStandardQuote } from "@/lib/revisions/server";

export const runtime = "nodejs";

// POST /api/standard-quotes/[id]/revise { reason } -- reopen an issued quotation as the next revision in preparation. The reason is
// required (it is kept and written into the revision row when that revision is issued). The issued revisions stay as they were.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const user = await getAuthUser();
  const result = await reviseStandardQuote(createAdminSupabase(), supabase, { tenantId, quoteId: id, reason: body.reason, actor: { id: user?.id ?? null, email: user?.email ?? null } });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ working_revision: result.working_revision });
}
