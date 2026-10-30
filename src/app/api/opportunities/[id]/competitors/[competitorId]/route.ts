import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { findByName, parseCompetitorEdit, sameCompany } from "@/lib/tender/competitors/rules";
import { PENDING_COMPETITORS, PENDING_RESEARCH, UUID, listCompetitors, loadCompetitor, markWinner, syncDealWinner } from "@/lib/tender/competitors/server";

// PATCH  /api/opportunities/[id]/competitors/[competitorId] -- change a competitor, mark / unmark it as the winner ({ is_winner }), or answer
//        a proposal from market research ({ status: "accepted" | "rejected" }). Marking a winner clears the others and writes the name where
//        the older screens read "who won"; only an accepted competitor can be the winner. A rejected one keeps its name, hidden, so a later
//        research run does not propose it again.
// DELETE /api/opportunities/[id]/competitors/[competitorId] -- remove it (a winner's name is cleared from the deal as well).
// The competitor is looked up by its id AND this deal AND this workspace, so another workspace's id is the same 404 as a missing one.

const FIELD_LABEL: Record<string, string> = {
  name: "name", website: "website", country: "country", expected_price: "expected price", strengths: "strengths", notes: "note", is_winner: "winner",
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { id, competitorId } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(competitorId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { admin, supabase, tenantId, userId, opp } = gate.req;
  const { row, error: loadError, legacy } = await loadCompetitor(admin, tenantId, id, competitorId);
  if (loadError) return NextResponse.json({ error: isMissingSchema(loadError) ? PENDING_COMPETITORS : loadError.message }, { status: isMissingSchema(loadError) ? 503 : 500 });
  if (!row || row.status === "rejected") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseCompetitorEdit(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const { is_winner, status, ...fields } = parsed.value;
  if (status !== undefined && legacy) return NextResponse.json({ error: PENDING_RESEARCH }, { status: 503 });
  if (status === "rejected" && row.status !== "proposed") return NextResponse.json({ error: "Only a proposed competitor can be rejected. Remove one you added yourself." }, { status: 409 });
  if (is_winner === true && (status ?? row.status) !== "accepted") return NextResponse.json({ error: "Accept this competitor before marking it as the winner" }, { status: 409 });
  if (fields.name && !sameCompany(fields.name, row.name)) {
    const { rows } = await listCompetitors(admin, tenantId, id, { includeRejected: true });
    if (findByName(rows.filter((c) => c.id !== row.id), fields.name)) return NextResponse.json({ error: "That competitor is already on the list" }, { status: 409 });
  }

  if (Object.keys(fields).length > 0 || (status !== undefined && status !== row.status)) {
    const { error } = await admin.from("opportunity_competitors").update({ ...fields, ...(status !== undefined ? { status } : {}), updated_at: new Date().toISOString() }).eq("id", competitorId).eq("opportunity_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.code === "23505" ? "That competitor is already on the list" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  }
  const name = fields.name ?? row.name;
  if (is_winner === true) {
    const marked = await markWinner(admin, tenantId, id, { id: competitorId, name });
    if (!marked.ok) return NextResponse.json({ error: marked.error }, { status: 500 });
  } else if (is_winner === false && row.is_winner) {
    const { error } = await admin.from("opportunity_competitors").update({ is_winner: false, updated_at: new Date().toISOString() }).eq("id", competitorId).eq("opportunity_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await syncDealWinner(admin, tenantId, id, null, row.name);
  } else if (row.is_winner && fields.name && fields.name !== row.name) {
    // A renamed winner: the deal keeps saying the same company.
    await syncDealWinner(admin, tenantId, id, fields.name, row.name);
  }

  const user = await getAuthUser();
  const before = row as unknown as Record<string, unknown>;
  const changes = Object.entries({ ...fields, ...(is_winner !== undefined && is_winner !== row.is_winner ? { is_winner } : {}) })
    .filter(([k, v]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null))
    .map(([k, v]) => k === "is_winner" ? { field: "winner", from: v ? null : row.name, to: v ? name : null } : { field: FIELD_LABEL[k] ?? k, from: before[k] ?? null, to: v ?? null });
  if (status !== undefined && status !== row.status) changes.push({ field: status === "accepted" ? "competitor accepted" : "competitor rejected", from: null, to: name });
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "opportunity_competitors", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
      actorId: user?.id ?? userId, actorEmail: user?.email, changes,
    });
  }
  const { row: fresh } = await loadCompetitor(admin, tenantId, id, competitorId);
  return NextResponse.json({ ok: true, competitor: fresh });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { id, competitorId } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(competitorId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { admin, supabase, tenantId, userId, opp } = gate.req;
  const { row, error: loadError } = await loadCompetitor(admin, tenantId, id, competitorId);
  if (loadError) return NextResponse.json({ error: isMissingSchema(loadError) ? PENDING_COMPETITORS : loadError.message }, { status: isMissingSchema(loadError) ? 503 : 500 });
  if (!row || row.status === "rejected") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin.from("opportunity_competitors").delete().eq("id", competitorId).eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (row.is_winner) await syncDealWinner(admin, tenantId, id, null, row.name);
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_competitors", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email, changes: [{ field: "competitor removed", from: row.name, to: null }],
  });
  return new NextResponse(null, { status: 204 });
}
