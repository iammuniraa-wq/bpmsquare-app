import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { issueStandardQuote } from "@/lib/revisions/server";

export const runtime = "nodejs";

// POST /api/standard-quotes/[id]/issue { reason? } -- freeze the working copy into an immutable revision (document_revisions) and
// lock the quotation. Any user who may edit the quote may issue it; there is no internal approval step (owner, 2026-11-23). The
// first issue (Rev. 00) needs no reason; every later one must say why. The tenant comes from the session, never from the body.
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
  const result = await issueStandardQuote(createAdminSupabase(), supabase, { tenantId, quoteId: id, reason: body.reason, actor: { id: user?.id ?? null, email: user?.email ?? null } });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ revision_no: result.revision_no });
}
