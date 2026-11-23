import { NextResponse, type NextRequest } from "next/server";
import { resolveAnalysisAccess } from "@/lib/analysis/access";
import { analysisAccess } from "@/lib/analysis/gate";
import { loadBriefHistory } from "@/lib/analysis/report/historyServer";
import { parseReportInput } from "@/lib/assistant/reportTool";
import { readDockReport, type ReportStepCtx } from "@/lib/assistant/reportRun";

// GET /api/ai/report/brief?account_id=... (or lead_id, or name, domain, country) -- what the card shows beside the research:
//   brief    the saved brief for this company, read from this workspace's cache. No web, no model, no limit used.
//   history  "Your history with them", read live from the workspace's own records through this person's permissions.
// `include` picks one or both (default both). The history is never cached and never written anywhere; the brief never holds it.
// Tenant and person come from the session; the request names only the company, and an account or lead id is verified against the
// workspace before it is used for anything.

export async function GET(request: NextRequest) {
  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return access;
  const gate = analysisAccess(access);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status });

  const q = request.nextUrl.searchParams;
  const input = parseReportInput({ account_id: q.get("account_id"), lead_id: q.get("lead_id"), name: q.get("name"), domain: q.get("domain"), country: q.get("country") });
  if (!input.accountId && !input.leadId && !input.name && !input.domain) return NextResponse.json({ error: "Name the company, or give its account." }, { status: 400 });
  const include = new Set((q.get("include") ?? "brief,history").split(",").map((s) => s.trim()));
  const now = new Date();

  const out: { brief?: unknown; history?: unknown } = {};
  if (include.has("brief")) {
    const ctx: ReportStepCtx = {
      supabase: access.supabase, tenantId: access.tenantId, userId: access.userId, perms: access.perms, features: access.features, route: null, now,
      setup: { admin: access.admin, config: access.config, budget: access.budget }, userTurns: [], openCompany: null, open: null,
    };
    const r = await readDockReport(ctx, input);
    if (!r.ok) return NextResponse.json({ error: r.message }, { status: 404 });
    out.brief = r.dock;
  }
  if (include.has("history")) {
    const h = await loadBriefHistory(access, { accountId: input.accountId, leadId: input.leadId, name: input.name ?? undefined, domain: input.domain ?? undefined, country: input.country ?? undefined }, now);
    if (!h.ok) return NextResponse.json({ error: h.error }, { status: h.status });
    out.history = h.history;
  }
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
