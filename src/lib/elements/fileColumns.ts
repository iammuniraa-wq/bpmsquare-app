import "server-only";
import { readAllPages } from "@/lib/pagedRead";
import type { BoqRequest } from "@/lib/tender/boq/server";
import { assignLines, wbsCtx } from "@/lib/tender/wbs/server";
import { loadItems, loadMembers } from "@/lib/tender/wbs/read";
import { cleanElementCode } from "./pattern";
import { buildingsOn, loadElementSettings, loadElementTypes } from "./server";
import { setLineElement } from "./tenderServer";

// The building and element columns of the CLIENT'S OWN Excel (docs/design/pcbs-buildings-elements.md section 2.5, way 1). The upload keeps its layout
// detection and keeps every column it does not know in the line's client columns (migration 0242); these three are then read from there into the
// line's element fields and its building, by the writers the screen uses. Nothing here can fail the upload: every problem is a note.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BUILDING = new Set(["building", "building code", "building no", "building area", "building and area", "area", "block"]);
const TYPE = new Set(["element type", "type of element", "piece type"]);
const CODE = new Set(["element code", "element id", "element no", "piece mark"]);

/** What a line's client columns say about its building, element type and element code, by the header names the design lists. */
export function elementColumnsOf(clientData: Readonly<Record<string, string>> | null | undefined): { building: string | null; type: string | null; code: string | null } {
  const out = { building: null as string | null, type: null as string | null, code: null as string | null };
  for (const [label, value] of Object.entries(clientData ?? {})) {
    const h = norm(label);
    const v = typeof value === "string" && value.trim() ? value.trim() : null;
    if (!v) continue;
    if (BUILDING.has(h)) out.building = v; else if (TYPE.has(h)) out.type = v; else if (CODE.has(h)) out.code = v;
  }
  return out;
}

export type FileElementResult = { applied: number; notes: string[] };

type Row = { id: string; item_key: string | null; item_no: string | null; row_no: number; element_type: string | null; element_code: string | null };

/**
 * A building named in the file is matched by code or by name among the tender's buildings (a building that has activities is not a target: the lines go to
 * an activity by hand). An UNKNOWN one is listed in the notes and NOT created: the person adds it, then groups the lines. A value the line already has is
 * never overwritten, so a person's edit survives a revised file.
 */
export async function applyFileElementColumns(req: BoqRequest, incoming: readonly { key: string; client_data?: Readonly<Record<string, string>> | null }[]): Promise<FileElementResult> {
  const result: FileElementResult = { applied: 0, notes: [] };
  const wanted = incoming.map((l) => ({ key: l.key, ...elementColumnsOf(l.client_data) })).filter((l) => l.building || l.type || l.code);
  if (wanted.length === 0 || !(await buildingsOn(req.supabase, req.tenantId))) return result;
  const { admin, tenantId, opp } = req;
  const [items, members, read, settings, types] = await Promise.all([
    loadItems(admin, tenantId, opp.id), loadMembers(admin, tenantId, opp.id),
    readAllPages((lo, hi) => admin.from("tender_boq_lines").select("id, item_key, item_no, row_no, element_type, element_code").eq("tenant_id", tenantId).eq("opportunity_id", opp.id).order("row_no", { ascending: true }).order("id", { ascending: true }).range(lo, hi)),
    loadElementSettings(), loadElementTypes(admin, tenantId),
  ]);
  if (items.pending || items.buildingsPending || members.pending || read.error) return result;
  const typeSet = new Set(types.map((t) => t.code));
  const byKey = new Map(((read.data ?? []) as unknown as Row[]).filter((r) => r.item_key).map((r) => [r.item_key as string, r]));
  const buildings = items.items.filter((i) => i.building_code && !items.items.some((c) => c.parent_id === i.id));
  const unknown = new Set<string>();
  const ctx = wbsCtx(req);
  const name = (r: Row) => r.item_no ?? `#${r.row_no}`;
  for (const w of wanted) {
    const row = byKey.get(w.key);
    if (!row) continue;
    const edit: Record<string, unknown> = {};
    if (w.type && !row.element_type) {
      const t = w.type.trim().toUpperCase();
      if (typeSet.has(t)) edit.element_type = t; else result.notes.push(`Element type ${w.type} (line ${name(row)}) is not in your Element types list`);
    }
    if (w.code && !row.element_code) {
      const c = cleanElementCode(w.code, settings.code_max);
      if (c.ok) edit.element_code = c.code; else result.notes.push(`Element code ${w.code} (line ${name(row)}): ${c.error}`);
    }
    if (Object.keys(edit).length > 0) {
      const done = await setLineElement(req, row.id, edit);
      if (done.ok) result.applied++; else result.notes.push(`Line ${name(row)}: ${done.error}`);
    }
    if (w.building && members.members.item.get(row.id) == null && (members.members.parts.get(row.id) ?? []).length === 0) {
      const label = w.building.trim().toLowerCase();
      const hit = buildings.find((b) => b.building_code?.toLowerCase() === label || b.name.trim().toLowerCase() === label);
      if (!hit) { unknown.add(w.building.trim()); continue; }
      const put = await assignLines(ctx, [row.id], hit.id);
      if (put.ok) result.applied++; else result.notes.push(`Line ${name(row)}: ${put.error}`);
    }
  }
  if (unknown.size > 0) result.notes.push(`${unknown.size === 1 ? "A building" : `${unknown.size} buildings`} named in the file ${unknown.size === 1 ? "is" : "are"} not on this tender (${[...unknown].slice(0, 5).join(", ")}). Add ${unknown.size === 1 ? "it" : "them"} in the Buildings section, then group the lines`);
  if (result.applied > 0 || result.notes.length > 0) await ctx.log([{ field: "Building and element columns read from the file", from: null, to: `${result.applied} change${result.applied === 1 ? "" : "s"}${result.notes.length ? `, ${result.notes.length} note${result.notes.length === 1 ? "" : "s"}` : ""}` }]);
  return result;
}
