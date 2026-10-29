import { NextResponse, NextRequest } from "next/server";
import { resolveAnalysisAccess } from "@/lib/analysis/access";
import { analyseCompany } from "@/lib/analysis/service";
import { analysisAccess } from "@/lib/analysis/gate";
import { toDock } from "@/lib/assistant/analysisRun";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { isMissingSchema } from "@/lib/tender/server";
import { PENDING_COMPETITORS, UUID, loadCompetitor } from "@/lib/tender/competitors/server";

// A web analysis runs up to four searches server-side before the model answers (the same call as POST /api/ai/analysis).
export const maxDuration = 120;

// POST /api/opportunities/[id]/competitors/[competitorId]/insights { refresh? } -- the company analysis card for one competitor.
// The company is NEVER taken from the request: the name, website and country come from the competitor row, which is looked up by its id,
// this deal and this workspace first. Pressing the button is the person's yes to web research for that one company; the service applies
// its cache (a fresh saved card is returned at once, free), the hourly refresh limit, the daily limit and the monthly AI allowance, and
// keeps the saved card as the fallback. Flag off or no Accounts view: 403 with a plain reason.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { id, competitorId } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(competitorId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { admin, tenantId } = gate.req;
  const { row, error: loadError } = await loadCompetitor(admin, tenantId, id, competitorId);
  if (loadError) return NextResponse.json({ error: isMissingSchema(loadError) ? PENDING_COMPETITORS : loadError.message }, { status: isMissingSchema(loadError) ? 503 : 500 });
  if (!row || row.status === "rejected") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return access;
  const allowed = analysisAccess(access);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error, code: allowed.code }, { status: allowed.status });

  const body = await request.json().catch(() => null);
  const refresh = !!body && typeof body === "object" && (body as Record<string, unknown>).refresh === true;
  const input = { name: row.name, domain: row.website ?? undefined, country: row.country ?? undefined, refresh, allowWeb: true };
  try {
    const r = await analyseCompany(access, input);
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    const now = new Date();
    const analysis = toDock(r.card, {
      cached: r.cached, saved: r.saved, notice: r.notice ?? null, now,
      input: { accountId: null, name: row.name, domain: row.website, country: row.country, refresh },
    });
    return NextResponse.json({ analysis, pendingDb: r.pendingDb });
  } catch (e) {
    console.error("Competitor insights failed:", e);
    return NextResponse.json({ error: "The analysis is unavailable right now." }, { status: 500 });
  }
}
