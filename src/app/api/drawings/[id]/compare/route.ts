import { NextResponse, type NextRequest } from "next/server";
import { failResponse } from "@/lib/drawings/http";
import { openDrawing } from "@/lib/drawings/open";
import { loadElements, loadRevision, loadRevisions } from "@/lib/drawings/server";
import { compareElements, modelQtyByCode, type CompareEl } from "@/lib/drawings/compare";
import { loadPinsOfDrawing } from "@/lib/drawings/boqPins";
import type { ElementRow } from "@/lib/drawings/types";

// GET /api/drawings/[id]/compare?from=<revision id>&to=<revision id>
//   How two revisions of this drawing differ, element by element: matched by model id first, then by element code; elements with neither are
//   listed as "not matched", never guessed. Defaults: `to` is the open revision (else the newest), `from` the released one (else the one before).
//   Computed, never AI. The effect on the tender BOQ lines that take a quantity from this drawing is shown beside it, and what it would
//   change: the model quantity of those lines. NOTHING is written here, and nothing here ever edits an approved BOQ or budget.

type Ctx = { params: Promise<{ id: string }> };

const asCompare = (e: ElementRow): CompareEl => ({ model_uid: e.model_uid, element_code: e.element_code, element_type: e.element_type, building: e.building, level: e.level, qty: e.qty, unit: e.unit, volume_m3: e.volume_m3, area_m2: e.area_m2, length_m: e.length_m, weight_t: e.weight_t });

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const opened = await openDrawing(id);
  if (!opened.ok) return failResponse(opened);
  const { admin, tenantId } = opened.req;
  const { rows: revs } = await loadRevisions(admin, tenantId, id);
  if (revs.length === 0) return NextResponse.json({ error: "No revisions" }, { status: 404 });
  const sp = request.nextUrl.searchParams;
  const open = [...revs].reverse().find((r) => r.status === "draft" || r.status === "in_review");
  const toRev = sp.get("to") ? await loadRevision(admin, tenantId, id, sp.get("to")!) : (open ?? revs[revs.length - 1]);
  if (!toRev) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  const earlier = revs.filter((r) => r.rev_no < toRev.rev_no);
  const fromRev = sp.get("from") ? await loadRevision(admin, tenantId, id, sp.get("from")!)
    : (revs.find((r) => r.id === opened.drawing.current_rev_id && r.id !== toRev.id) ?? earlier[earlier.length - 1] ?? null);
  if (sp.get("from") && !fromRev) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

  const [toEls, fromEls] = await Promise.all([loadElements(admin, tenantId, toRev.id), fromRev ? loadElements(admin, tenantId, fromRev.id) : Promise.resolve([] as ElementRow[])]);
  const comparison = compareElements(fromEls.map(asCompare), toEls.map(asCompare));

  // The effect on lines that take a quantity from this drawing: the model quantity they would have under `to`.
  const { pins } = await loadPinsOfDrawing(admin, tenantId, id);
  const toQty = modelQtyByCode(toEls);
  const effect = pins.filter((p) => p.element_code).map((p) => {
    const next = toQty.get(p.element_code!) ?? 0;
    const was = p.model_qty ?? 0;
    return { boq_id: p.boq_id, opportunity_id: p.opportunity_id, item: p.item_no ?? `#${p.row_no}`, description: p.description, element_code: p.element_code, was, becomes: next, delta: Math.round((next - was) * 1000) / 1000, pinned_label: p.pinned_label, state: p.state };
  });
  return NextResponse.json({
    from: fromRev, to: toRev, comparison: { ...comparison, rows: comparison.rows.filter((r) => sp.get("unchanged") === "1" || r.kind !== "unchanged").slice(0, 2000), unchangedShown: sp.get("unchanged") === "1" },
    unchangedRows: comparison.rows.filter((r) => r.kind === "unchanged").length, hasElements: { from: fromEls.length > 0, to: toEls.length > 0 }, effect,
  });
}
