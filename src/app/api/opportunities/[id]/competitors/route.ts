import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { resolveAnalysisAccess } from "@/lib/analysis/access";
import { analysisAccess } from "@/lib/analysis/gate";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { listBidVersions } from "@/lib/tender/bids/server";
import { COMPETITOR_LIMITS, findByName, parseNewCompetitor, readResearchAnswers, type CompetitorsData } from "@/lib/tender/competitors/rules";
import { COMPETITOR_COLS_LEGACY, PENDING_COMPETITORS, listCompetitors, toView } from "@/lib/tender/competitors/server";

// GET  /api/opportunities/[id]/competitors -- the companies we expect to bid against on this tender deal (the team's own and the ones market
//      research proposed, each labelled), our latest bid to set a likely price against, and whether Company insights may be offered to this
//      person (the answer only hides a button; the insights route decides again).
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
  const { admin, tenantId, tender } = gate.req;
  const { rows, pending, researchPending } = await listCompetitors(admin, tenantId, id);
  const latest = pending || rows.length === 0 ? null : (await listBidVersions(admin, tenantId, id)).versions[0] ?? null;
  const body: CompetitorsData = {
    competitors: rows, pending, researchPending,
    insights: await insightsFor(),
    our_bid: latest ? { total: latest.total, currency: latest.currency, version_no: latest.version_no } : null,
    research: readResearchAnswers((tender.custom_data as Record<string, unknown> | null)?.competitor_research),
  };
  return NextResponse.json(body);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId, opp } = gate.req;
  const parsed = parseNewCompetitor(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const { rows: all, pending } = await listCompetitors(admin, tenantId, id, { includeRejected: true });
  if (pending) return NextResponse.json({ error: PENDING_COMPETITORS }, { status: 503 });
  const rows = all.filter((x) => x.status !== "rejected");
  if (rows.length >= COMPETITOR_LIMITS.perDeal) return NextResponse.json({ error: `A deal can hold ${COMPETITOR_LIMITS.perDeal} competitors` }, { status: 409 });
  const same = findByName(all, parsed.value.name);
  if (same && same.status !== "rejected") return NextResponse.json({ error: same.status === "proposed" ? "That company is already proposed. Accept it from the list." : "That competitor is already on the list" }, { status: 409 });

  // A company the team once rejected comes back when a person adds it by hand: that is their own yes.
  if (same) {
    const restored = await admin.from("opportunity_competitors")
      .update({ ...parsed.value, status: "accepted", updated_at: new Date().toISOString() }).eq("id", same.id).eq("opportunity_id", id).eq("tenant_id", tenantId);
    if (restored.error) return NextResponse.json({ error: restored.error.message }, { status: 500 });
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunity_competitors", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
      actorId: user?.id ?? userId, actorEmail: user?.email, changes: [{ field: "competitor added", from: null, to: parsed.value.name }],
    });
    return NextResponse.json({ ok: true, competitor: { ...same, ...parsed.value, status: "accepted" } }, { status: 201 });
  }

  const { data, error } = await admin.from("opportunity_competitors")
    .insert({ tenant_id: tenantId, opportunity_id: id, ...parsed.value, created_by: userId, sort: all.length })
    .select(COMPETITOR_COLS_LEGACY).maybeSingle();
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
  return NextResponse.json({ ok: true, competitor: data ? toView(data as unknown as Record<string, unknown>) : null }, { status: 201 });
}
