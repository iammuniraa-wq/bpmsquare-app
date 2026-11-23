import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "./server";
import { differsByPct, pinChipLabel, pinState, type PinState } from "./review";

// The READ side of the BOQ pins (migration 0257), kept apart from the routes' gate so the BOQ screen's own loader can use it without a
// circular import. Every query is tenant-scoped on the admin client; a pending migration reads as "no pins", never an error.

export type PinView = {
  boq_id: string; item_no: string | null; row_no: number; description: string; client_qty: number;
  drawing_id: string; drawing_no: string; element_code: string | null; pinned_label: string; current_label: string | null;
  model_qty: number | null; state: PinState; chip: string; differs_pct: number | null; dismissed_reason: string | null;
};

export type PinRow = { id: string; opportunity_id: string; item_no: string | null; row_no: number; file_description: string; file_qty: number | string; element_code: string | null; drawing_rev_id: string | null; model_qty: number | string | null; drawing_review_rev_id: string | null; drawing_review_reason: string | null };
export const PIN_COLS = "id, opportunity_id, item_no, row_no, file_description, file_qty, element_code, drawing_rev_id, model_qty, drawing_review_rev_id, drawing_review_reason";

async function viewsFor(admin: SupabaseClient, tenantId: string, rows: PinRow[]): Promise<PinView[]> {
  if (rows.length === 0) return [];
  const revIds = [...new Set(rows.flatMap((r) => [r.drawing_rev_id, r.drawing_review_rev_id]).filter((x): x is string => !!x))];
  const { data: revs } = await admin.from("drawing_revisions").select("id, drawing_id, rev_label").eq("tenant_id", tenantId).in("id", revIds);
  const rev = new Map(((revs ?? []) as { id: string; drawing_id: string; rev_label: string }[]).map((r) => [r.id, r]));
  const drawingIds = [...new Set([...rev.values()].map((r) => r.drawing_id))];
  const { data: ds } = drawingIds.length ? await admin.from("drawings").select("id, drawing_no, current_rev_id").eq("tenant_id", tenantId).in("id", drawingIds) : { data: [] };
  const drawing = new Map(((ds ?? []) as { id: string; drawing_no: string; current_rev_id: string | null }[]).map((d) => [d.id, d]));
  const currentIds = [...new Set([...drawing.values()].map((d) => d.current_rev_id).filter((x): x is string => !!x))].filter((i) => !rev.has(i));
  if (currentIds.length) {
    const { data: more } = await admin.from("drawing_revisions").select("id, drawing_id, rev_label").eq("tenant_id", tenantId).in("id", currentIds);
    for (const r of (more ?? []) as { id: string; drawing_id: string; rev_label: string }[]) rev.set(r.id, r);
  }
  const out: PinView[] = [];
  for (const r of rows) {
    const pinned = r.drawing_rev_id ? rev.get(r.drawing_rev_id) : undefined;
    const d = pinned ? drawing.get(pinned.drawing_id) : undefined;
    if (!pinned || !d) continue;
    const state = pinState({ pinnedRevId: r.drawing_rev_id, currentRevId: d.current_rev_id, dismissedRevId: r.drawing_review_rev_id });
    if (!state) continue;
    const currentLabel = d.current_rev_id ? rev.get(d.current_rev_id)?.rev_label ?? null : null;
    const clientQty = Number(r.file_qty ?? 0);
    const model = r.model_qty == null ? null : Number(r.model_qty);
    out.push({
      boq_id: r.id, item_no: r.item_no, row_no: r.row_no, description: r.file_description, client_qty: clientQty, drawing_id: d.id, drawing_no: d.drawing_no,
      element_code: r.element_code, pinned_label: pinned.rev_label, current_label: currentLabel, model_qty: model, state,
      chip: pinChipLabel(state, d.drawing_no, pinned.rev_label, currentLabel), differs_pct: differsByPct(clientQty, model), dismissed_reason: state === "dismissed" ? r.drawing_review_reason : null,
    });
  }
  return out;
}

/** The pinned lines of a tender. A database without 0257 reads as no pins (never an error: the BOQ must keep loading). */
export async function loadPins(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ pins: PinView[]; pending: boolean }> {
  const { data, error } = await admin.from("tender_boq_lines").select(PIN_COLS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).not("drawing_rev_id", "is", null).order("row_no", { ascending: true });
  if (error) return { pins: [], pending: isMissingSchema(error) };
  return { pins: await viewsFor(admin, tenantId, (data ?? []) as unknown as PinRow[]), pending: false };
}

/** Every pinned line that uses ANY revision of one drawing, across tenders: the "used by" of the drawing and the effect of a comparison. */
export async function loadPinsOfDrawing(admin: SupabaseClient, tenantId: string, drawingId: string): Promise<{ pins: (PinView & { opportunity_id: string })[]; pending: boolean }> {
  const { data: revs } = await admin.from("drawing_revisions").select("id").eq("tenant_id", tenantId).eq("drawing_id", drawingId);
  const ids = ((revs ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { pins: [], pending: false };
  const { data, error } = await admin.from("tender_boq_lines").select(PIN_COLS).eq("tenant_id", tenantId).in("drawing_rev_id", ids).order("row_no", { ascending: true });
  if (error) return { pins: [], pending: isMissingSchema(error) };
  const rows = (data ?? []) as unknown as PinRow[];
  const views = await viewsFor(admin, tenantId, rows);
  const opp = new Map(rows.map((r) => [r.id, r.opportunity_id]));
  return { pins: views.map((v) => ({ ...v, opportunity_id: opp.get(v.boq_id) ?? "" })), pending: false };
}

/** What the BOQ screen needs on its rows: a chip label and a tone per BOQ line id, for the lines of one tender. Never throws. */
export async function boqDrawingFlags(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<Map<string, { label: string; review: boolean }>> {
  try {
    const { pins } = await loadPins(admin, tenantId, opportunityId);
    return new Map(pins.map((p) => [p.boq_id, { label: p.chip, review: p.state === "review" }]));
  } catch {
    return new Map();
  }
}

