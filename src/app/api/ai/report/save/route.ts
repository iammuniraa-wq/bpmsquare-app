import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { resolveAnalysisAccess } from "@/lib/analysis/access";
import { analysisAccess } from "@/lib/analysis/gate";
import { saveReportComment, saveReportCompetitor, type SaveKind } from "@/lib/analysis/report/save";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { isUuid } from "@/lib/assistant/objects";
import { recordReportAudit } from "@/lib/assistant/reportAudit";
import type { TenantFeatures } from "@/lib/constants";

// POST /api/ai/report/save { kind, id, competitor_id?, key } -- the Save button of a company report in the dock.
// Nothing about the report comes from the request: `key` only names which saved report (a company key inside THIS
// workspace's cache), and the content is read back from there. `id` is checked against the workspace before use, and the
// person needs what the Nova comments route needs (module, workcenter view) or, for a competitor, edit on the Pipeline.

const KINDS = ["account", "lead", "deal", "competitor"] as const;

export async function POST(request: NextRequest) {
  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return access;
  const gate = analysisAccess(access);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kind = typeof body?.kind === "string" && (KINDS as readonly string[]).includes(body.kind) ? (body.kind as (typeof KINDS)[number]) : null;
  const id = typeof body?.id === "string" ? body.id.trim().toLowerCase() : "";
  const competitorId = typeof body?.competitor_id === "string" ? body.competitor_id.trim().toLowerCase() : "";
  const key = typeof body?.key === "string" ? body.key.trim().slice(0, 300) : "";
  if (!kind || !isUuid(id) || !key || (kind === "competitor" && !isUuid(competitorId))) {
    return NextResponse.json({ error: "That save request is not valid." }, { status: 400 });
  }

  const { admin, tenantId, userId, features, perms } = access;
  const done = async (status: "done" | "failed", reason: string | undefined) => recordReportAudit({
    kind: "report_save", tenantId, userId, route: null, params: { kind, id, ...(competitorId ? { competitor_id: competitorId } : {}), key },
    status, reason, sources: [], result: {},
  });

  let result;
  if (kind === "competitor") {
    const deal = await openTenderDealRequest(id, true);
    if (!deal.ok) return NextResponse.json({ error: deal.error }, { status: deal.status });
    result = await saveReportCompetitor({ admin: deal.req.admin, tenantId: deal.req.tenantId }, id, competitorId, key);
  } else {
    const user = await getAuthUser();
    result = await saveReportComment({ admin, tenantId, userId, email: user?.email ?? null, features: features as Partial<TenantFeatures>, perms }, kind as SaveKind, id, key);
  }
  if (!result.ok) {
    await done("failed", result.error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await done("done", undefined);
  return NextResponse.json({ message: result.message });
}
