import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { resolveAnalysisAccess } from "@/lib/analysis/access";
import { analysisAccess } from "@/lib/analysis/gate";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { COMPETITOR_LIMITS, findByName, parseNewCompetitor, type CompetitorsData } from "@/lib/tender/competitors/rules";
import { COMPETITOR_COLS, PENDING_COMPETITORS, listCompetitors } from "@/lib/tender/competitors/server";

// GET  /api/opportunities/[id]/competitors -- the companies we expect to bid against on this tender deal, and whether Company insights
//      may be offered to this person (the answer only hides a button; the insights route decides again).
// POST /api/opportunities/[id]/competitors -- add one. Only the name is required. The workspace, the deal and the maker are the session's.
// A standard deal, a workspace without the tender edition and another workspace's deal are the same 404 (openTenderDealRequest).

async function insightsFor(): Promise<CompetitorsData["insights"]> {
  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return { available: false, reason: "Company insights are not available to you." };
  const gate = analysisAccess(access);
  return gate.ok ? { available: true } : { available: false, reason: gate.error };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId } = gate.req;
  const { rows, pending } = await listCompetitors(admin, tenantId, id);
  const body: CompetitorsData = { competitors: rows, pending, insights: rows.length > 0 ? await insightsFor() : { available: false } };
  return NextResponse.json(body);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId, opp } = gate.req;
  const parsed = parseNewCompetitor(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const { rows, pending } = await listCompetitors(admin, tenantId, id);
  if (pending) return NextResponse.json({ error: PENDING_COMPETITORS }, { status: 503 });
  if (rows.length >= COMPETITOR_LIMITS.perDeal) return NextResponse.json({ error: `A deal can hold ${COMPETITOR_LIMITS.perDeal} competitors` }, { status: 409 });
  if (findByName(rows, parsed.value.name)) return NextResponse.json({ error: "That competitor is already on the list" }, { status: 409 });

  const { data, error } = await admin.from("opportunity_competitors")
    .insert({ tenant_id: tenantId, opportunity_id: id, ...parsed.value, created_by: userId, sort: rows.length })
    .select(COMPETITOR_COLS).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: PENDING_COMPETITORS }, { status: 503 });
    if (error.code === "23505") return NextResponse.json({ error: "That competitor is already on the list" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_competitors", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email, changes: [{ field: "competitor added", from: null, to: parsed.value.name }],
  });
  return NextResponse.json({ ok: true, competitor: data }, { status: 201 });
}
