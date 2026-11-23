import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { drawingDwGate } from "@/lib/drawings/dw";
import { drawingNoProblem, normaliseDrawingNo, numberingProblem } from "@/lib/drawings/rules";
import { loadType, UUID_RE } from "@/lib/drawings/server";
import type { RowOutcome } from "@/lib/import/types";

// Updates drawing HEADER fields by the real record id (an Export gives it): title, external number, custom fields, and the drawing number only
// while nothing was ever submitted. Never the status, a revision, a file, the type or where it is filed: those have their own routes and
// rules (a released revision is never edited, and the type decides who may release). A row whose id is not in this workspace fails clearly.

const ALLOWED = ["title", "external_no", "custom_data"];

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "drawings");
  if (gate) return gate;
  const g = await drawingDwGate(supabase, tenantId, userId, role, "edit");
  if (!g.ok) return g.response;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  const admin = g.ctx.admin;

  const ids = rows.map((r) => r.values.id?.trim()).filter((i): i is string => !!i && UUID_RE.test(i));
  const submitted = new Set<string>();
  const typeOf = new Map<string, string | null>();
  const numberOf = new Map<string, string>();
  if (ids.length) {
    const { data: ds } = await admin.from("drawings").select("id, drawing_no, type_id").eq("tenant_id", tenantId).in("id", ids);
    for (const d of (ds ?? []) as { id: string; drawing_no: string; type_id: string | null }[]) { typeOf.set(d.id, d.type_id); numberOf.set(d.id, d.drawing_no); }
    const { data: rs } = await admin.from("drawing_revisions").select("drawing_id, status, submitted_at").eq("tenant_id", tenantId).in("drawing_id", ids);
    for (const r of (rs ?? []) as { drawing_id: string; status: string; submitted_at: string | null }[]) if (r.status !== "draft" || r.submitted_at) submitted.add(r.drawing_id);
  }

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  const typeCache = new Map<string, Awaited<ReturnType<typeof loadType>>>();
  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) patch[key] = values[key] || null;
    if ("title" in patch && !patch.title) { outcomes.push({ rowNum, status: "failed", reason: "A title cannot be blank" }); continue; }
    if ("drawing_no" in values && values.drawing_no?.trim()) {
      const next = normaliseDrawingNo(values.drawing_no);
      if (numberOf.has(id) && next !== numberOf.get(id)) {
        if (submitted.has(id)) { outcomes.push({ rowNum, status: "failed", reason: "The number is fixed once a revision was submitted" }); continue; }
        const problem = drawingNoProblem(next);
        if (problem) { outcomes.push({ rowNum, status: "failed", reason: problem }); continue; }
        const tid = typeOf.get(id) ?? null;
        if (tid && !typeCache.has(tid)) typeCache.set(tid, await loadType(admin, tenantId, tid));
        const numbering = numberingProblem(tid ? typeCache.get(tid)?.numbering_pattern : null, next);
        if (numbering) { outcomes.push({ rowNum, status: "failed", reason: numbering }); continue; }
        patch.drawing_no = next;
      }
    }
    if ("custom_data" in patch) patch.custom_data = Object.fromEntries(Object.entries(values).filter(([k, v]) => k.startsWith("cf_") && v?.trim()));
    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(admin, "drawings", tenantId, prepared, outcomes, { objectType: "drawings", labelField: "drawing_no", actorId: user?.id, actorEmail: user?.email }));
}
