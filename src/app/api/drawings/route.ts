import { NextResponse, type NextRequest } from "next/server";
import { readAllPages } from "@/lib/pagedRead";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { DRAWING_COLS, isMissingSchema, needsUpdate, normaliseRevision, openDrawingRequest, REVISION_COLS } from "@/lib/drawings/server";
import { createDrawing } from "@/lib/drawings/writes";
import { headlineRevision } from "@/lib/drawings/rules";
import type { DrawingRow, RevisionRow } from "@/lib/drawings/types";

// GET  /api/drawings  every drawing of the workspace with the revision it is "at" (the released one, else the newest).
// POST /api/drawings  { drawing_no, title, type_id?, external_no?, opportunity_id?, project_id?, wbs_item_id?, notes? } -> the drawing and its first
//        revision (a draft). Every foreign id is verified against the caller's own workspace first.

export async function GET(request: NextRequest) {
  const gate = await openDrawingRequest();
  if (!gate.ok) return failResponse(gate);
  const { admin, tenantId } = gate.req;
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const { data, error } = await readAllPages((lo, hi) => admin.from("drawings").select(DRAWING_COLS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi));
  if (error) return isMissingSchema(error) ? failResponse(needsUpdate()) : NextResponse.json({ error: error.message }, { status: 500 });
  let drawings = (data ?? []) as unknown as DrawingRow[];
  if (q) drawings = drawings.filter((d) => `${d.drawing_no} ${d.title} ${d.ref ?? ""} ${d.external_no ?? ""}`.toLowerCase().includes(q));
  const { data: revs } = await readAllPages((lo, hi) => admin.from("drawing_revisions").select(REVISION_COLS).eq("tenant_id", tenantId).order("id", { ascending: true }).range(lo, hi));
  const byDrawing = new Map<string, RevisionRow[]>();
  for (const r of ((revs ?? []) as unknown as Record<string, unknown>[]).map(normaliseRevision)) byDrawing.set(r.drawing_id, [...(byDrawing.get(r.drawing_id) ?? []), r]);
  return NextResponse.json(drawings.map((d) => {
    const at = headlineRevision(byDrawing.get(d.id) ?? [], d.current_rev_id);
    return { id: d.id, ref: d.ref, drawing_no: d.drawing_no, title: d.title, external_no: d.external_no, type_id: d.type_id, opportunity_id: d.opportunity_id, project_id: d.project_id,
      archived_at: d.archived_at, rev_label: at?.rev_label ?? null, rev_status: at?.status ?? null, released: !!d.current_rev_id };
  }));
}

export async function POST(request: NextRequest) {
  const gate = await openDrawingRequest({ write: true });
  if (!gate.ok) return failResponse(gate);
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const made = await createDrawing(gate.req, body);
  if (!made.ok) return failResponse(made);
  return NextResponse.json({ ...made.drawing, revision: made.revision }, { status: 201 });
}
