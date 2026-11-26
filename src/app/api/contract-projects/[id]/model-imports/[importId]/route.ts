import { NextResponse, type NextRequest } from "next/server";
import { openAllocation } from "@/lib/contractProjects/allocationServer";
import { UUID_RE } from "@/lib/contractProjects/server";
import { applyImport, dismissImport, getImport } from "@/lib/elements/modelServer";
import { failed, readBody, NOT_FOUND } from "@/lib/elements/respond";
import { buildingsOn } from "@/lib/elements/server";

// GET    /api/contract-projects/[id]/model-imports/[importId]
//          One comparison with its rows, matched against the budget as it stands now: Same, Quantity changed, New element, New building, and what the
//          budget has that the model does not mention (flagged, never removed). `target` says which revision a change would land on.
// PATCH  { action: "apply", rows: number[], justification_code?, justification_text? }
//          "Apply selected": writes the ticked rows into a DRAFT revision only (revision 0 before a baseline is approved; the open draft after; else a new
//          draft started with the reason, default Scope change). A Same row, a not-in-the-model row and an ambiguous row are never written. Nothing is
//          applied when no ticked row can be. 200 { revision_rev_no, started_revision, text, notes }.
//        { action: "dismiss" }   keeps the comparison for the record and leaves the budget alone.
// `importId` is a comparison of THIS project; any other id is a 404.

type Ctx = { params: Promise<{ id: string; importId: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id, importId } = await params;
  if (!UUID_RE.test(importId)) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
  const open = await openAllocation(id, false);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const out = await getImport(open, importId);
  if (!out.ok) return failed(out);
  return NextResponse.json({ import: out.row, rows: out.rows, target: out.target });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id, importId } = await params;
  if (!UUID_RE.test(importId)) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (body.action === "dismiss") {
    const out = await dismissImport(open, importId);
    return out.ok ? NextResponse.json({ status: out.status }) : failed(out);
  }
  if (body.action !== "apply") return NextResponse.json({ error: "action must be apply or dismiss" }, { status: 400 });
  const rows = Array.isArray(body.rows) ? body.rows.filter((n): n is number => Number.isInteger(n) && n >= 1).slice(0, 5000) : [];
  const out = await applyImport(open, importId, {
    rows,
    justification_code: typeof body.justification_code === "string" ? body.justification_code : undefined,
    justification_text: typeof body.justification_text === "string" ? body.justification_text : null,
  });
  if (!out.ok) return failed(out);
  return NextResponse.json({ revision_rev_no: out.revision_rev_no, started_revision: out.started_revision, text: out.text, notes: out.notes });
}
