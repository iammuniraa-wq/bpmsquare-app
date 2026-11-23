import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantHasFeature } from "@/lib/tenant";
import { canEditWorkcenter, canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { openBoqRequest, type BoqRequest } from "@/lib/tender/boq/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { isMissingSchema, UUID_RE } from "./server";
import { PIN_COLS, loadPins, type PinRow, type PinView } from "./pinsRead";
export { boqDrawingFlags, loadPins, loadPinsOfDrawing, type PinView } from "./pinsRead";
import { groupReleased, loadReleasedElements, piecesOfCode, type ElementGroup } from "./released";

// Where a tender's BOQ line takes a quantity from a RELEASED drawing revision (docs/design/pcbs-drawing-register.md section 4, migration 0257).
// A pin is five nullable columns on tender_boq_lines; it never touches the client's own quantity (file_qty) or the deal line's quantity: the
// model quantity sits BESIDE them with a "differs by n %" chip. Pinning reads released elements only (released.ts), so a draft or in-review
// revision can never feed a line. A newer release changes nothing by itself: the line is flagged "review changes" until a person applies or
// dismisses it, with a reason.

export const PINS_PENDING = "Drawing quantities need a database update (migration 0257). Ask your administrator to apply it.";

/** The gate of the pin routes: the tender BOQ's own (gcc_tender + pipeline, a tender of THIS workspace) plus the register's flag and workcenter. */
export async function openPinRequest(opportunityId: string, write: boolean): Promise<{ ok: true; req: BoqRequest } | { ok: false; status: number; error: string }> {
  const gate = await openBoqRequest(opportunityId, write);
  if (!gate.ok) return gate;
  const { supabase, tenantId, userId, role } = gate.req;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  if (!(await tenantHasFeature(supabase, tenantId, "drawing_register"))) return notFound;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "drawing_register")) return notFound;
  if (write && !canEditWorkcenter(perms, "drawing_register")) return { ok: false, status: 403, error: "You can view drawings but not change them" };
  return gate;
}

/** The BOQ lines of the tender a person may pin (the client's own lines, not those dropped in a revised file). */
export async function pinnableLines(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ id: string; label: string; client_qty: number; pinned: boolean }[]> {
  const { data, error } = await admin.from("tender_boq_lines").select("id, item_no, row_no, file_description, file_qty, drawing_rev_id, removed_in_revision").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("removed_in_revision", false).order("row_no", { ascending: true }).limit(2000);
  if (error) return [];
  return ((data ?? []) as { id: string; item_no: string | null; row_no: number; file_description: string; file_qty: number | string; drawing_rev_id?: string | null }[]).map((r) => ({
    id: r.id, label: `${r.item_no?.trim() || `#${r.row_no}`} ${r.file_description}`.trim().slice(0, 120), client_qty: Number(r.file_qty ?? 0), pinned: !!r.drawing_rev_id,
  }));
}

/** The released element groups a tender may take from: drawings filed under this tender, or under no tender at all. */
export async function groupsForTender(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ groups: ElementGroup[]; pending: boolean }> {
  const own = await loadReleasedElements(admin, { tenantId, opportunityId });
  return { groups: groupReleased(own.rows), pending: own.pending };
}

type Out = { ok: true; pin: PinView | null } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Out => ({ ok: false, status, error });

async function logPin(r: BoqRequest, field: string, to: unknown, from: unknown = null): Promise<void> {
  const u = await getAuthUser();
  await logChange(r.supabase, { tenantId: r.tenantId, objectType: "opportunities", objectId: r.opp.id, objectLabel: r.opp.title ?? null, action: "update", actorId: u?.id ?? r.userId, actorEmail: u?.email, changes: [{ field, from, to }] });
}

async function loadLine(r: BoqRequest, boqId: string): Promise<PinRow | null> {
  if (!UUID_RE.test(boqId)) return null;
  const { data } = await r.admin.from("tender_boq_lines").select(PIN_COLS).eq("id", boqId).eq("opportunity_id", r.opp.id).eq("tenant_id", r.tenantId).maybeSingle();
  return (data as unknown as PinRow | null) ?? null;
}

/** Pin a BOQ line to an element code of a drawing's RELEASED revision. The model quantity is the pieces of that code in that revision. */
export async function pinLine(r: BoqRequest, body: { boq_line_id?: unknown; drawing_id?: unknown; element_code?: unknown }): Promise<Out> {
  const boqId = typeof body.boq_line_id === "string" ? body.boq_line_id : "";
  const drawingId = typeof body.drawing_id === "string" ? body.drawing_id : "";
  const code = typeof body.element_code === "string" ? body.element_code.trim().slice(0, 120) : "";
  if (!code) return fail(422, "Choose the element code the quantity comes from");
  if (!UUID_RE.test(drawingId)) return fail(422, "Choose a drawing");
  const line = await loadLine(r, boqId);
  if (!line) return fail(404, "BOQ line not found");
  const { data: d } = await r.admin.from("drawings").select("id, drawing_no, opportunity_id, current_rev_id, archived_at").eq("id", drawingId).eq("tenant_id", r.tenantId).maybeSingle();
  const dwg = d as { id: string; drawing_no: string; opportunity_id: string | null; current_rev_id: string | null; archived_at: string | null } | null;
  if (!dwg) return fail(404, "Drawing not found");
  if (dwg.opportunity_id && dwg.opportunity_id !== r.opp.id) return fail(422, "That drawing is filed under a different tender");
  if (!dwg.current_rev_id) return fail(422, "That drawing has no released revision yet. Only a released revision can feed the bill of quantities");
  const released = await loadReleasedElements(r.admin, { tenantId: r.tenantId, drawingId });
  if (released.pending) return fail(503, "Reading drawing elements needs a database update (migration 0256).");
  const qty = piecesOfCode(released.rows, drawingId, code);
  if (qty === null) return fail(422, `The released revision has no element with the code ${code}`);
  const { error } = await r.admin.from("tender_boq_lines").update({ element_code: code, drawing_rev_id: dwg.current_rev_id, model_qty: qty, drawing_review_rev_id: null, drawing_review_reason: null })
    .eq("id", line.id).eq("opportunity_id", r.opp.id).eq("tenant_id", r.tenantId);
  if (error) return fail(isMissingSchema(error) ? 503 : 500, isMissingSchema(error) ? PINS_PENDING : error.message);
  await logPin(r, `Drawing quantity on line ${line.item_no ?? `#${line.row_no}`}`, `${dwg.drawing_no} ${code}: ${qty}`, line.drawing_rev_id ? "re-pinned" : null);
  return { ok: true, pin: (await loadPins(r.admin, r.tenantId, r.opp.id)).pins.find((p) => p.boq_id === line.id) ?? null };
}

/** Take the newly released revision's quantity for a flagged line, and pin to it. */
export async function applyPin(r: BoqRequest, boqId: string): Promise<Out> {
  const line = await loadLine(r, boqId);
  if (!line || !line.drawing_rev_id || !line.element_code) return fail(404, "That line is not pinned to a drawing");
  const { data: rv } = await r.admin.from("drawing_revisions").select("drawing_id").eq("id", line.drawing_rev_id).eq("tenant_id", r.tenantId).maybeSingle();
  const drawingId = (rv as { drawing_id: string } | null)?.drawing_id;
  if (!drawingId) return fail(404, "Drawing not found");
  const { data: d } = await r.admin.from("drawings").select("id, drawing_no, current_rev_id").eq("id", drawingId).eq("tenant_id", r.tenantId).maybeSingle();
  const dwg = d as { id: string; drawing_no: string; current_rev_id: string | null } | null;
  if (!dwg?.current_rev_id) return fail(409, "That drawing has no released revision");
  if (dwg.current_rev_id === line.drawing_rev_id) return { ok: true, pin: (await loadPins(r.admin, r.tenantId, r.opp.id)).pins.find((p) => p.boq_id === line.id) ?? null };
  const released = await loadReleasedElements(r.admin, { tenantId: r.tenantId, drawingId });
  const qty = piecesOfCode(released.rows, drawingId, line.element_code);
  if (qty === null) return fail(422, `The newly released revision has no element with the code ${line.element_code}. Dismiss the change or remove the pin`);
  const { error } = await r.admin.from("tender_boq_lines").update({ drawing_rev_id: dwg.current_rev_id, model_qty: qty, drawing_review_rev_id: null, drawing_review_reason: null })
    .eq("id", line.id).eq("opportunity_id", r.opp.id).eq("tenant_id", r.tenantId);
  if (error) return fail(500, error.message);
  await logPin(r, `Drawing quantity on line ${line.item_no ?? `#${line.row_no}`}`, `${dwg.drawing_no} ${line.element_code}: ${qty}`, line.model_qty == null ? null : Number(line.model_qty));
  return { ok: true, pin: (await loadPins(r.admin, r.tenantId, r.opp.id)).pins.find((p) => p.boq_id === line.id) ?? null };
}

/** Keep the quantity as it is for the newly released revision, with a reason. The chip is quiet for THAT revision only. */
export async function dismissPin(r: BoqRequest, boqId: string, reasonRaw: unknown): Promise<Out> {
  const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim().slice(0, 500) : "";
  if (!reason) return fail(422, "Say why the quantity stays as it is");
  const line = await loadLine(r, boqId);
  if (!line || !line.drawing_rev_id) return fail(404, "That line is not pinned to a drawing");
  const { data: rv } = await r.admin.from("drawing_revisions").select("drawing_id").eq("id", line.drawing_rev_id).eq("tenant_id", r.tenantId).maybeSingle();
  const drawingId = (rv as { drawing_id: string } | null)?.drawing_id;
  const { data: d } = drawingId ? await r.admin.from("drawings").select("id, drawing_no, current_rev_id").eq("id", drawingId).eq("tenant_id", r.tenantId).maybeSingle() : { data: null };
  const dwg = d as { drawing_no: string; current_rev_id: string | null } | null;
  if (!dwg?.current_rev_id || dwg.current_rev_id === line.drawing_rev_id) return fail(409, "There is no newer release to review");
  const { error } = await r.admin.from("tender_boq_lines").update({ drawing_review_rev_id: dwg.current_rev_id, drawing_review_reason: reason })
    .eq("id", line.id).eq("opportunity_id", r.opp.id).eq("tenant_id", r.tenantId);
  if (error) return fail(500, error.message);
  await logPin(r, `Drawing change kept on line ${line.item_no ?? `#${line.row_no}`}`, reason);
  return { ok: true, pin: (await loadPins(r.admin, r.tenantId, r.opp.id)).pins.find((p) => p.boq_id === line.id) ?? null };
}

export async function unpinLine(r: BoqRequest, boqId: string): Promise<Out> {
  const line = await loadLine(r, boqId);
  if (!line || !line.drawing_rev_id) return fail(404, "That line is not pinned to a drawing");
  const { error } = await r.admin.from("tender_boq_lines").update({ element_code: null, drawing_rev_id: null, model_qty: null, drawing_review_rev_id: null, drawing_review_reason: null })
    .eq("id", line.id).eq("opportunity_id", r.opp.id).eq("tenant_id", r.tenantId);
  if (error) return fail(500, error.message);
  await logPin(r, `Drawing quantity on line ${line.item_no ?? `#${line.row_no}`}`, null, line.element_code);
  return { ok: true, pin: null };
}

/**
 * The baseline blocker (design section 4): a tender whose BOQ still has a line waiting for a person to review a newer release cannot have its
 * project baseline asked for. Returns the message, or null when nothing blocks (also when the register is off or not installed).
 */
export async function drawingBaselineBlocker(admin: SupabaseClient, tenantId: string, opportunityId: string | null): Promise<string | null> {
  if (!opportunityId) return null;
  try {
    if (!(await tenantHasFeature(admin, tenantId, "drawing_register"))) return null;
    const { pins } = await loadPins(admin, tenantId, opportunityId);
    const waiting = pins.filter((p) => p.state === "review");
    if (waiting.length === 0) return null;
    return `${waiting.length} bill of quantities line${waiting.length === 1 ? "" : "s"} still carr${waiting.length === 1 ? "ies" : "y"} a quantity from an older drawing revision (${waiting.slice(0, 3).map((p) => `${p.drawing_no} ${p.pinned_label} to ${p.current_label ?? "?"}`).join(", ")}${waiting.length > 3 ? ", ..." : ""}). Review them in the Drawings screen first`;
  } catch {
    return null;
  }
}
