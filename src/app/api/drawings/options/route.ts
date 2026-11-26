import { NextResponse, type NextRequest } from "next/server";
import { failResponse } from "@/lib/drawings/http";
import { ensureDefaultType, listTypes, openDrawingRequest, UUID_RE } from "@/lib/drawings/server";

// GET /api/drawings/options[?opportunity_id=]  what the new-drawing form offers: the active drawing types, the tenders and projects of this
// workspace to file the drawing under, and (once a tender is chosen) that tender's buildings (its WBS items). Every list is tenant-scoped and
// capped; a table that does not exist yet (tender edition off, WBS pending) simply gives an empty list.

export async function GET(request: NextRequest) {
  const gate = await openDrawingRequest();
  if (!gate.ok) return failResponse(gate);
  const { admin, tenantId } = gate.req;
  await ensureDefaultType(admin, tenantId);
  const { rows: types } = await listTypes(admin, tenantId);

  const { data: tenderRows } = await admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).limit(500);
  const oppIds = ((tenderRows ?? []) as { opportunity_id: string }[]).map((r) => r.opportunity_id);
  const { data: opps } = oppIds.length ? await admin.from("opportunities").select("id, ref, title").eq("tenant_id", tenantId).in("id", oppIds).order("created_at", { ascending: false }).limit(500) : { data: [] };
  const { data: projects } = await admin.from("contract_projects").select("id, ref, name").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);

  const oppId = request.nextUrl.searchParams.get("opportunity_id");
  let buildings: { id: string; label: string }[] = [];
  if (oppId && UUID_RE.test(oppId)) {
    const { data } = await admin.from("tender_wbs_items").select("id, code, name").eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("sort_order", { ascending: true }).limit(500);
    buildings = ((data ?? []) as { id: string; code: string; name: string }[]).map((b) => ({ id: b.id, label: `${b.code} ${b.name}`.trim() }));
  }
  return NextResponse.json({
    types: types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, numbering_pattern: t.numbering_pattern })),
    tenders: ((opps ?? []) as { id: string; ref: string | null; title: string }[]).map((o) => ({ id: o.id, label: `${o.ref ?? ""} ${o.title}`.trim() })),
    projects: ((projects ?? []) as { id: string; ref: string | null; name: string }[]).map((p) => ({ id: p.id, label: `${p.ref ?? ""} ${p.name}`.trim() })),
    buildings,
  });
}
