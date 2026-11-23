import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/tender/server";

// THE one reader of the elements that downstream features may use (docs/design/pcbs-drawing-register.md section 4): "only Released feeds the
// BOQ, the estimate and the handover" is true because everything outside the register reads through THIS function, over the database view
// `released_drawing_elements` (0256), which holds the elements of released revisions only and is readable by the service role alone.
// src/lib/drawings/released.guard.test.ts fails the build if any other file reads the elements table or the view, so a draft or
// in-review revision cannot leak into a BOQ line, an estimate or a handover.

export type ReleasedElement = {
  id: string; drawing_id: string; revision_id: string; drawing_no: string; drawing_title: string; opportunity_id: string | null; project_id: string | null;
  rev_label: string; rev_no: number; released_at: string | null; effective_from: string | null;
  model_uid: string | null; element_code: string | null; element_type: string | null; building: string | null; wbs_item_id: string | null; level: string | null;
  qty: number; unit: string | null; volume_m3: number | null; area_m2: number | null; length_m: number | null; weight_t: number | null; weight_calculated: boolean;
};

const COLS = "id, drawing_id, revision_id, drawing_no, drawing_title, opportunity_id, project_id, rev_label, rev_no, released_at, effective_from, model_uid, element_code, element_type, building, wbs_item_id, level, qty, unit, volume_m3, area_m2, length_m, weight_t, weight_calculated";
const n = (v: unknown): number | null => (v == null ? null : Number(v));

export type ReleasedQuery = {
  tenantId: string;
  /** At least one of these narrows to a tender, a project or one drawing; a call with none reads the whole workspace (a report). */
  opportunityId?: string | null;
  projectId?: string | null;
  drawingId?: string | null;
  building?: string | null;
};

/** The elements of every RELEASED revision that matches, tenant-scoped. A pending migration answers `pending: true` and no rows, never a crash. */
export async function loadReleasedElements(admin: SupabaseClient, q: ReleasedQuery): Promise<{ rows: ReleasedElement[]; pending: boolean }> {
  const rows: ReleasedElement[] = [];
  for (let from = 0; ; from += 1000) {
    let query = admin.from("released_drawing_elements").select(COLS).eq("tenant_id", q.tenantId);
    if (q.opportunityId) query = query.eq("opportunity_id", q.opportunityId);
    if (q.projectId) query = query.eq("project_id", q.projectId);
    if (q.drawingId) query = query.eq("drawing_id", q.drawingId);
    if (q.building) query = query.eq("building", q.building);
    const { data, error } = await query.order("drawing_no", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
    if (error) return { rows: [], pending: isMissingSchema(error) };
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch.map((r) => ({ ...(r as unknown as ReleasedElement), rev_no: Number(r.rev_no ?? 0), qty: Number(r.qty ?? 0), volume_m3: n(r.volume_m3), area_m2: n(r.area_m2), length_m: n(r.length_m), weight_t: n(r.weight_t), weight_calculated: r.weight_calculated === true })));
    if (batch.length < 1000) break;
  }
  return { rows, pending: false };
}

export type ElementGroup = { key: string; drawing_id: string; drawing_no: string; rev_label: string; revision_id: string; building: string; element_type: string; element_code: string | null; pieces: number; volume_m3: number; weight_t: number };

/** Released elements grouped for "Import from model": one row per drawing, building and element code (or type when a row has no code). */
export function groupReleased(rows: readonly ReleasedElement[]): ElementGroup[] {
  const map = new Map<string, ElementGroup>();
  for (const e of rows) {
    const building = e.building?.trim() || "No building", type = e.element_type?.trim() || "No type";
    const key = `${e.drawing_id}\u0000${building}\u0000${e.element_code ?? `type:${type}`}`;
    const g = map.get(key) ?? { key, drawing_id: e.drawing_id, drawing_no: e.drawing_no, rev_label: e.rev_label, revision_id: e.revision_id, building, element_type: type, element_code: e.element_code, pieces: 0, volume_m3: 0, weight_t: 0 };
    g.pieces += e.qty;
    g.volume_m3 += (e.volume_m3 ?? 0) * e.qty;
    g.weight_t += (e.weight_t ?? 0) * e.qty;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => a.drawing_no.localeCompare(b.drawing_no) || a.building.localeCompare(b.building) || (a.element_code ?? "").localeCompare(b.element_code ?? ""));
}

/** The pieces of one element code in a drawing's released revision (what a BOQ line pinned to that code takes as its model quantity). */
export function piecesOfCode(rows: readonly ReleasedElement[], drawingId: string, code: string): number | null {
  const hit = rows.filter((r) => r.drawing_id === drawingId && r.element_code === code);
  return hit.length ? hit.reduce((s, r) => s + r.qty, 0) : null;
}
