import { NextResponse, type NextRequest } from "next/server";
import { resolveAnalysisAccess, parseAnalyseInput } from "@/lib/analysis/access";
import { analyseCompany, readCachedAnalysis } from "@/lib/analysis/service";

// A web analysis runs up to four searches server-side before the model answers, then a second small call words one sentence.
export const maxDuration = 120;

// POST /api/ai/analysis { account_id? | name? domain? country?, refresh?, allow_web } -> the company analysis card.
// allow_web is the person's yes to web research for this company; without it nothing leaves the workspace and a saved
// card (or one built from the workspace's own records) is returned. A limit never hides a saved card: it comes back with
// a `notice`. Flag off or no Accounts view: 403. An account id from another workspace: 404, before its name is used.
export async function POST(request: NextRequest) {
  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => null);
  const input = parseAnalyseInput(body && typeof body === "object" ? (body as Record<string, unknown>) : null);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const r = await analyseCompany(access, input);
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({ card: r.card, cached: r.cached, saved: r.saved, pendingDb: r.pendingDb, notice: r.notice ?? null });
  } catch (e) {
    console.error("Company analysis failed:", e);
    return NextResponse.json({ error: "The analysis is unavailable right now." }, { status: 500 });
  }
}

// GET /api/ai/analysis?account_id= (or ?name=&domain=&country=) -> the saved card only. No web, no cost, no limit used.
export async function GET(request: NextRequest) {
  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return access;
  const p = request.nextUrl.searchParams;
  const input = parseAnalyseInput({ account_id: p.get("account_id"), name: p.get("name"), domain: p.get("domain"), country: p.get("country") });
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const r = await readCachedAnalysis(access, input);
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({ card: r.card, pendingDb: r.pendingDb });
  } catch (e) {
    console.error("Company analysis read failed:", e);
    return NextResponse.json({ error: "The analysis is unavailable right now." }, { status: 500 });
  }
}
