import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import type { BoqRequest } from "@/lib/tender/boq/server";
import {
  addProblem, autoCodes, cleanText, codeChanges, holdersOf, isLeaf, moveProblem, partsOf, pctText, renumberAll, setSplit, WBS_LIMITS,
  type Membership, type Share,
} from "@/lib/wbs/tree";
import { WBS_PENDING } from "@/lib/wbs/tips";
import { loadItems, loadMembers, ownerNames } from "./read";
import { buildWbsState, type BoqFigureLine } from "./view";
import type { LineMembers, SplitRequestPart, WbsItemRow, WbsState } from "./types";

// The writes of the tender WBS (migration 0243; docs/design/wbs.md section 2.8). Every route reaches these through openBoqRequest() (flags
// gcc_tender + pipeline, the Pipeline workcenter, a tender deal of THIS workspace). Every query is tenant- and deal-scoped on the service-role
// client; every id from a request (parent, item, BOQ line, owner) is checked against THIS workspace and THIS deal before it is used, and an id
// that is not found is a 404, never a silent re-parent. A missing table or column reads as "WBS needs a database update", never as a crash.

export type Failure = { status: number; error: string; extra?: Record<string, unknown> };
export type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);
type Change = { field: string; from: unknown; to: unknown };

export type WbsCtx = {
  admin: SupabaseClient; tenantId: string; opportunityId: string; userId: string | null;
  /** Writes the change history of the tender. A test passes a recorder. */
  log: (changes: Change[]) => Promise<void>;
};

export function wbsCtx(r: BoqRequest): WbsCtx {
  return {
    admin: r.admin, tenantId: r.tenantId, opportunityId: r.opp.id, userId: r.userId,
    log: async (changes) => {
      const user = await getAuthUser();
      await logChange(r.supabase, {
        tenantId: r.tenantId, objectType: "opportunity_tenders", objectId: r.opp.id, objectLabel: `${r.opp.ref ?? ""} ${r.opp.title}`.trim(), action: "update",
        actorId: user?.id, actorEmail: user?.email, changes,
      });
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const pending: Failure = { status: 503, error: WBS_PENDING };
const missing = (e: { code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204");
const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const fail = (status: number, error: string, extra?: Record<string, unknown>): { ok: false } & Failure => ({ ok: false, status, error, ...(extra ? { extra } : {}) });

type Loaded = { items: WbsItemRow[]; members: LineMembers };
async function load(ctx: WbsCtx): Promise<Result<Loaded>> {
  const [it, mem] = await Promise.all([loadItems(ctx.admin, ctx.tenantId, ctx.opportunityId), loadMembers(ctx.admin, ctx.tenantId, ctx.opportunityId)]);
  if (it.pending || mem.pending) return { ok: false, ...pending };
  return { ok: true, items: it.items, members: mem.members };
}

const memberships = (members: LineMembers): Map<string, Membership> =>
  new Map([...members.item.keys()].map((id) => [id, { wbs_item_id: members.item.get(id) ?? null, parts: members.parts.get(id) ?? [] }]));
const holders = (members: LineMembers) => holdersOf(memberships(members).values());
const labelOf = (items: readonly WbsItemRow[], id: string) => items.find((i) => i.id === id)?.code ?? "?";
const heldBy = (members: LineMembers, itemId: string): number => [...memberships(members).values()].filter((m) => partsOf(m).some((p) => p.wbs_item_id === itemId)).length;
const nextSort = (items: readonly WbsItemRow[], parentId: string | null) => items.filter((i) => i.parent_id === parentId).reduce((m, i) => Math.max(m, i.sort_order), 0) + 10;

/** A bid-time owner only has to be an active employee of this workspace: no login is needed while bidding (it is on the project). */
async function checkBidOwner(ctx: WbsCtx, employeeId: string): Promise<Failure | null> {
  const emp = await ctx.admin.from("employees").select("id, first_name, last_name, status").eq("id", employeeId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (emp.error || !emp.data) return { status: 404, error: "Employee not found" };
  const e = emp.data as { first_name: string | null; last_name: string | null; status: string };
  if (e.status !== "active") return { status: 422, error: `${[e.first_name, e.last_name].filter(Boolean).join(" ") || "That employee"} is not active` };
  return null;
}

/** Sets the codes a recode produced. Items are parked on unique temporary codes first, so a swap never meets the (deal, code) constraint. */
async function applyCodes(ctx: WbsCtx, changes: readonly { id: string; to: string; manual_cleared?: boolean }[]): Promise<string | null> {
  if (changes.length === 0) return null;
  const now = new Date().toISOString();
  const write = (id: string, code: string, extra: Record<string, unknown> = {}) =>
    ctx.admin.from("tender_wbs_items").update({ code, updated_at: now, ...extra }).eq("id", id).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
  if (changes.length > 1) {
    for (const c of changes) {
      const { error } = await write(c.id, `~${c.id.replace(/-/g, "").slice(0, 18)}`);
      if (error) return error.message;
    }
  }
  for (const c of changes) {
    const { error } = await write(c.id, c.to, c.manual_cleared ? { code_is_manual: false } : {});
    if (error) return error.message;
  }
  return null;
}

/** Recodes every auto-numbered item of the deal after the tree changed. `items` is the tree AS IT NOW STANDS. */
async function recode(ctx: WbsCtx, items: readonly WbsItemRow[]): Promise<string | null> {
  return applyCodes(ctx, codeChanges(items).map((c) => ({ id: c.id, to: c.to })));
}

// ── Writing where lines sit ─────────────────────────────────────────────────────────────────────────────────────────

/** Points whole lines at an item (null = unassigned) and drops any split they had. Ids are already known to be this deal's lines. */
async function writeAssign(ctx: WbsCtx, boqIds: readonly string[], itemId: string | null): Promise<string | null> {
  const now = new Date().toISOString();
  for (const part of chunks(boqIds, 100)) {
    const gone = await ctx.admin.from("tender_wbs_line_parts").delete().eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).in("boq_line_id", part);
    if (gone.error) return gone.error.message;
    const set = await ctx.admin.from("tender_boq_lines").update({ wbs_item_id: itemId, updated_at: now }).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).in("id", part);
    if (set.error) return set.error.message;
  }
  return null;
}

/** Everything an item holds (whole lines and parts) moves to another item. */
async function moveHeldRows(ctx: WbsCtx, fromId: string, toId: string): Promise<string | null> {
  const a = await ctx.admin.from("tender_boq_lines").update({ wbs_item_id: toId, updated_at: new Date().toISOString() }).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).eq("wbs_item_id", fromId);
  if (a.error) return a.error.message;
  const b = await ctx.admin.from("tender_wbs_line_parts").update({ wbs_item_id: toId }).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).eq("wbs_item_id", fromId);
  return b.error ? b.error.message : null;
}

// ── Items ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ItemInput = { code?: unknown; name?: unknown; parent_id?: unknown; owner_employee_id?: unknown; note?: unknown; sort_order?: unknown; boq_ids?: unknown };

function boqIdsOf(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "boq_ids must be a list" };
  if (raw.length > 1000) return { ok: false, error: "Choose up to 1000 lines at a time" };
  const ids = [...new Set(raw.filter(isUuid))];
  if (ids.length !== new Set(raw).size || ids.length !== raw.length) return { ok: false, error: "Each line must be a valid, distinct id" };
  return { ok: true, ids };
}

const notMine = (members: LineMembers, ids: readonly string[]) => ids.some((id) => !members.item.has(id));

/** Creates an item. `boq_ids` puts those lines into it; adding a sub-item under an item that holds lines moves them into the new item. */
export async function createItem(ctx: WbsCtx, input: ItemInput): Promise<Result<{ id: string; code: string; moved: number }>> {
  const name = cleanText(input.name, WBS_LIMITS.nameMax);
  if (!name) return fail(422, "Give the WBS item a name");
  if (input.code != null && input.code !== "" && typeof input.code !== "string") return fail(422, "The code must be text");
  const typed = typeof input.code === "string" ? cleanText(input.code, WBS_LIMITS.codeMax) : null;
  const parentId = input.parent_id == null || input.parent_id === "" ? null : input.parent_id;
  if (parentId !== null && !isUuid(parentId)) return fail(422, "That parent is not a WBS item");
  if (input.owner_employee_id != null && input.owner_employee_id !== "" && !isUuid(input.owner_employee_id)) return fail(422, "The owner must be an employee");
  const ids = boqIdsOf(input.boq_ids);
  if (!ids.ok) return fail(422, ids.error);

  for (let attempt = 0; attempt < 3; attempt++) {
    const st = await load(ctx);
    if (!st.ok) return st;
    const { items, members } = st;
    if (parentId !== null && !items.some((i) => i.id === parentId)) return fail(404, "WBS item not found");
    const problem = addProblem(items, parentId);
    if (problem) return fail(items.length >= WBS_LIMITS.maxPerRecord ? 409 : 422, problem);
    if (notMine(members, ids.ids)) return fail(404, "A line is not on this tender");
    if (typed && items.some((i) => i.code === typed)) return fail(409, `The code ${typed} is already used on this tender`);
    if (typeof input.owner_employee_id === "string" && input.owner_employee_id) {
      const bad = await checkBidOwner(ctx, input.owner_employee_id);
      if (bad) return fail(bad.status, bad.error);
    }
    const id = randomUUID();
    const sort = nextSort(items, parentId);
    const draft: WbsItemRow = { id, opportunity_id: ctx.opportunityId, parent_id: parentId, code: typed ?? "?", name, owner_employee_id: typeof input.owner_employee_id === "string" && input.owner_employee_id ? input.owner_employee_id : null, sort_order: sort, code_is_manual: !!typed, note: cleanText(input.note, WBS_LIMITS.noteMax), created_at: new Date().toISOString() };
    const code = typed ?? (autoCodes([...items, draft]).get(id) as string);
    const ins = await ctx.admin.from("tender_wbs_items").insert({
      id, tenant_id: ctx.tenantId, opportunity_id: ctx.opportunityId, parent_id: parentId, code, name, owner_employee_id: draft.owner_employee_id, sort_order: sort,
      code_is_manual: !!typed, note: draft.note, created_by: ctx.userId,
    });
    if (ins.error) {
      if (ins.error.code === "23505") { if (typed) return fail(409, `The code ${typed} is already used on this tender`); continue; }
      return missing(ins.error) ? { ok: false, ...pending } : fail(500, ins.error.message);
    }

    let moved = 0;
    if (parentId !== null && holders(members).has(parentId)) {
      moved = heldBy(members, parentId);
      const err = await moveHeldRows(ctx, parentId, id);
      if (err) return fail(500, err);
    }
    if (ids.ids.length > 0) {
      const err = await writeAssign(ctx, ids.ids, id);
      if (err) return fail(500, err);
    }
    await ctx.log([{ field: `WBS ${code} added`, from: null, to: `${name}${ids.ids.length + moved > 0 ? `, ${ids.ids.length + moved} line${ids.ids.length + moved === 1 ? "" : "s"}` : ""}` }]);
    return { ok: true, id, code, moved };
  }
  return fail(409, "Another change took the next code. Try again");
}

/** Edits one item: name, code (a typed code is kept when renumbering), parent, owner, note, position. */
export async function updateItem(ctx: WbsCtx, id: string, input: ItemInput): Promise<Result<{ code: string }>> {
  if (!isUuid(id)) return fail(404, "WBS item not found");
  const st = await load(ctx);
  if (!st.ok) return st;
  const { items, members } = st;
  const cur = items.find((i) => i.id === id);
  if (!cur) return fail(404, "WBS item not found");
  const patch: Record<string, unknown> = {};
  const changes: Change[] = [];
  let tree = items;

  if ("name" in input) {
    const name = cleanText(input.name, WBS_LIMITS.nameMax);
    if (!name) return fail(422, "Give the WBS item a name");
    if (name !== cur.name) { patch.name = name; changes.push({ field: `WBS ${cur.code} renamed`, from: cur.name, to: name }); }
  }
  if ("note" in input) {
    const note = cleanText(input.note, WBS_LIMITS.noteMax);
    if (note !== cur.note) patch.note = note;
  }
  if ("owner_employee_id" in input) {
    const raw = input.owner_employee_id;
    if (raw != null && raw !== "" && !isUuid(raw)) return fail(422, "The owner must be an employee");
    const owner = typeof raw === "string" && raw ? raw : null;
    if (owner !== cur.owner_employee_id) {
      if (owner) { const bad = await checkBidOwner(ctx, owner); if (bad) return fail(bad.status, bad.error); }
      patch.owner_employee_id = owner;
      changes.push({ field: `WBS ${cur.code} owner`, from: cur.owner_employee_id, to: owner });
    }
  }
  let reorder = false;
  if ("parent_id" in input) {
    const raw = input.parent_id;
    if (raw != null && raw !== "" && !isUuid(raw)) return fail(422, "That parent is not a WBS item");
    const parent = typeof raw === "string" && raw ? raw : null;
    if (parent !== cur.parent_id) {
      if (parent !== null && !items.some((i) => i.id === parent)) return fail(404, "WBS item not found");
      const problem = moveProblem(items, id, parent, holders(members));
      if (problem) return fail(422, problem);
      patch.parent_id = parent;
      patch.sort_order = nextSort(items.filter((i) => i.id !== id), parent);
      tree = tree.map((i) => (i.id === id ? { ...i, parent_id: parent, sort_order: patch.sort_order as number } : i));
      changes.push({ field: `WBS ${cur.code} moved`, from: cur.parent_id ? labelOf(items, cur.parent_id) : "top level", to: parent ? labelOf(items, parent) : "top level" });
      reorder = true;
    }
  }
  if ("sort_order" in input && typeof input.sort_order === "number" && Number.isFinite(input.sort_order) && input.sort_order !== cur.sort_order) {
    patch.sort_order = Math.round(input.sort_order);
    tree = tree.map((i) => (i.id === id ? { ...i, sort_order: patch.sort_order as number } : i));
    reorder = true;
  }
  if ("code" in input) {
    const code = cleanText(input.code, WBS_LIMITS.codeMax);
    if (!code) {
      // Clearing a typed code hands the item back to the numbering.
      if (cur.code_is_manual) {
        patch.code_is_manual = false;
        tree = tree.map((i) => (i.id === id ? { ...i, code_is_manual: false } : i));
        reorder = true;
        changes.push({ field: `WBS ${cur.code} code`, from: cur.code, to: "numbered automatically" });
      }
    } else if (code !== cur.code) {
      if (items.some((i) => i.id !== id && i.code === code)) return fail(409, `The code ${code} is already used on this tender`);
      patch.code = code; patch.code_is_manual = true;
      tree = tree.map((i) => (i.id === id ? { ...i, code, code_is_manual: true } : i));
      changes.push({ field: `WBS ${cur.code} code`, from: cur.code, to: code });
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await ctx.admin.from("tender_wbs_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
    if (error) {
      if (error.code === "23505") return fail(409, `The code ${typeof patch.code === "string" ? patch.code : cur.code} is already used on this tender`);
      return missing(error) ? { ok: false, ...pending } : fail(500, error.message);
    }
  }
  let code = (patch.code as string | undefined) ?? cur.code;
  if (reorder || patch.code) {
    const current = tree.map((i) => (i.id === id && patch.code ? { ...i, code: patch.code as string } : i));
    const err = await recode(ctx, current);
    if (err) return fail(500, err);
    code = autoCodes(current).get(id) ?? code;
  }
  if (changes.length > 0) await ctx.log(changes);
  return { ok: true, code };
}

/**
 * Removes an item: its whole lines go back to Unassigned, its parts go with it (each split line then shows an unassigned remainder, nothing
 * is re-spread), and its sub-items move up one level. Auto codes close up.
 */
export async function deleteItem(ctx: WbsCtx, id: string): Promise<Result<{ lines: number; parts: number }>> {
  if (!isUuid(id)) return fail(404, "WBS item not found");
  const st = await load(ctx);
  if (!st.ok) return st;
  const { items, members } = st;
  const cur = items.find((i) => i.id === id);
  if (!cur) return fail(404, "WBS item not found");
  const mine = [...members.item.entries()].filter(([, item]) => item === id).map(([boq]) => boq);
  const partCount = [...members.parts.values()].filter((ps) => ps.some((p) => p.wbs_item_id === id)).length;

  // Sub-items move up first, so the tree is whole at every step.
  const kids = items.filter((i) => i.parent_id === id);
  const base = nextSort(items.filter((i) => i.id !== id), cur.parent_id);
  for (const [n, k] of kids.entries()) {
    const { error } = await ctx.admin.from("tender_wbs_items").update({ parent_id: cur.parent_id, sort_order: base + n * 10, updated_at: new Date().toISOString() }).eq("id", k.id).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
    if (error) return fail(500, error.message);
  }
  if (mine.length > 0) {
    const err = await writeAssignKeepParts(ctx, mine, null);
    if (err) return fail(500, err);
  }
  const parts = await ctx.admin.from("tender_wbs_line_parts").delete().eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).eq("wbs_item_id", id);
  if (parts.error) return fail(500, parts.error.message);
  const gone = await ctx.admin.from("tender_wbs_items").delete().eq("id", id).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
  if (gone.error) return fail(500, gone.error.message);

  const after = items.filter((i) => i.id !== id).map((i) => (i.parent_id === id ? { ...i, parent_id: cur.parent_id, sort_order: base + kids.findIndex((k) => k.id === i.id) * 10 } : i));
  const err = await recode(ctx, after);
  if (err) return fail(500, err);
  await ctx.log([{ field: `WBS ${cur.code} removed`, from: cur.name, to: mine.length + partCount > 0 ? `${mine.length} line${mine.length === 1 ? "" : "s"} to Unassigned${partCount > 0 ? `, ${partCount} share${partCount === 1 ? "" : "s"} of split lines now unassigned` : ""}` : null }]);
  return { ok: true, lines: mine.length, parts: partCount };
}

/** Whole lines back to unassigned without touching any parts (a removed item's parts are deleted separately). */
async function writeAssignKeepParts(ctx: WbsCtx, boqIds: readonly string[], itemId: string | null): Promise<string | null> {
  for (const part of chunks(boqIds, 100)) {
    const set = await ctx.admin.from("tender_boq_lines").update({ wbs_item_id: itemId, updated_at: new Date().toISOString() }).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).in("id", part);
    if (set.error) return set.error.message;
  }
  return null;
}

// ── Grouping and splitting ──────────────────────────────────────────────────────────────────────────────────────────

/** Group into WBS: puts whole lines into one leaf item (null = Unassigned). A split line in the list is unsplit; the answer says how many. */
export async function assignLines(ctx: WbsCtx, boqIdsRaw: unknown, itemRaw: unknown): Promise<Result<{ assigned: number; unsplit: number }>> {
  const ids = boqIdsOf(boqIdsRaw);
  if (!ids.ok) return fail(422, ids.error);
  if (ids.ids.length === 0) return fail(422, "Choose at least one line");
  if (itemRaw != null && !isUuid(itemRaw)) return fail(422, "That is not a WBS item");
  const itemId = (itemRaw as string | null | undefined) ?? null;
  const st = await load(ctx);
  if (!st.ok) return st;
  const { items, members } = st;
  if (notMine(members, ids.ids)) return fail(404, "A line is not on this tender");
  if (itemId !== null) {
    const target = items.find((i) => i.id === itemId);
    if (!target) return fail(404, "WBS item not found");
    if (!isLeaf(items, itemId)) return fail(422, `${target.code} has sub-items. Choose one of them`);
  }
  const unsplit = ids.ids.filter((b) => (members.parts.get(b) ?? []).length > 0).length;
  const before = itemId ? heldBy(members, itemId) : 0;
  const err = await writeAssign(ctx, ids.ids, itemId);
  if (err) return fail(500, err);
  if (itemId) {
    const was = ids.ids.filter((b) => partsOf({ wbs_item_id: members.item.get(b) ?? null, parts: members.parts.get(b) ?? [] }).some((p) => p.wbs_item_id === itemId)).length;
    await ctx.log([{ field: `WBS ${labelOf(items, itemId)} lines`, from: before, to: before + ids.ids.length - was }]);
  } else {
    await ctx.log([{ field: "WBS lines unassigned", from: null, to: `${ids.ids.length} line${ids.ids.length === 1 ? "" : "s"}` }]);
  }
  return { ok: true, assigned: ids.ids.length, unsplit };
}

async function lineOf(ctx: WbsCtx, boqId: string): Promise<{ id: string; item_no: string | null; row_no: number } | null> {
  if (!isUuid(boqId)) return null;
  const { data } = await ctx.admin.from("tender_boq_lines").select("id, item_no, row_no").eq("id", boqId).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).maybeSingle();
  return (data as { id: string; item_no: string | null; row_no: number } | null) ?? null;
}
const lineLabel = (l: { item_no: string | null; row_no: number }) => (l.item_no && l.item_no.trim() ? l.item_no : `#${l.row_no}`);

/** The parts of a split request, with any `new` item made on the spot. Validation comes first, so a refused split leaves no stray item. */
function readParts(raw: unknown): { ok: true; parts: SplitRequestPart[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "parts must be a list" };
  if (raw.length > 50) return { ok: false, error: "Split a line into up to 50 parts" };
  const parts: SplitRequestPart[] = [];
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const pct = typeof o.share_pct === "number" ? o.share_pct : typeof o.share_pct === "string" && o.share_pct.trim() !== "" ? Number(o.share_pct) : Number.NaN;
    if (!Number.isFinite(pct)) return { ok: false, error: "Every part needs a share" };
    if (o.wbs_item_id != null && !isUuid(o.wbs_item_id)) return { ok: false, error: "A part names something that is not a WBS item" };
    if (o.wbs_item_id && o.new) return { ok: false, error: "A part is an existing item or a new one, not both" };
    if (!o.wbs_item_id && !o.new) return { ok: false, error: "Every part needs a WBS item" };
    if (o.new) {
      const n = (typeof o.new === "object" ? o.new : {}) as Record<string, unknown>;
      const name = cleanText(n.name, WBS_LIMITS.nameMax);
      if (!name) return { ok: false, error: "Give the new WBS item a name" };
      if (n.parent_id != null && n.parent_id !== "" && !isUuid(n.parent_id)) return { ok: false, error: "That parent is not a WBS item" };
      parts.push({ new: { name, parent_id: (n.parent_id as string | null | undefined) || null }, share_pct: pct });
    } else parts.push({ wbs_item_id: o.wbs_item_id as string, share_pct: pct });
  }
  return { ok: true, parts };
}

/** Writes a line's split as one set. A set of one part is the line sitting whole in that item. */
export async function setLineSplit(ctx: WbsCtx, boqId: string, rawParts: unknown): Promise<Result<{ kind: "whole" | "parts"; parts: Share[]; created: string[] }>> {
  const line = await lineOf(ctx, boqId);
  if (!line) return fail(404, "Line not found");
  const read = readParts(rawParts);
  if (!read.ok) return fail(422, read.error);
  const st = await load(ctx);
  if (!st.ok) return st;
  let { items } = st;
  const { members } = st;
  const held = holders(members);

  // Validate on a draft tree in which every new item already exists under a placeholder id.
  const drafts: { key: string; row: WbsItemRow; name: string; parentId: string | null }[] = [];
  const candidate = [...items];
  const named: { wbs_item_id: string; share_pct: number }[] = [];
  for (const p of read.parts) {
    if (p.wbs_item_id) {
      if (!items.some((i) => i.id === p.wbs_item_id)) return fail(404, "WBS item not found");
      named.push({ wbs_item_id: p.wbs_item_id, share_pct: p.share_pct });
      continue;
    }
    const parentId = p.new?.parent_id ?? null;
    if (parentId !== null && !items.some((i) => i.id === parentId)) return fail(404, "WBS item not found");
    const problem = addProblem(candidate, parentId);
    if (problem) return fail(422, problem);
    if (parentId !== null && held.has(parentId)) return fail(422, `${labelOf(items, parentId)} holds lines. Add a sub-item for them first.`);
    const key = randomUUID();
    const row: WbsItemRow = { id: key, opportunity_id: ctx.opportunityId, parent_id: parentId, code: "?", name: p.new!.name, owner_employee_id: null, sort_order: nextSort(candidate, parentId), code_is_manual: false, note: null, created_at: new Date().toISOString() };
    candidate.push(row);
    drafts.push({ key, row, name: row.name, parentId });
    named.push({ wbs_item_id: key, share_pct: p.share_pct });
  }
  const verdict = setSplit(candidate, named);
  if (!verdict.ok) return fail(422, verdict.error);

  // Valid: make the new items for real.
  const created: string[] = [];
  const codes = autoCodes(candidate);
  for (const d of drafts) {
    const ins = await ctx.admin.from("tender_wbs_items").insert({
      id: d.key, tenant_id: ctx.tenantId, opportunity_id: ctx.opportunityId, parent_id: d.parentId, code: codes.get(d.key), name: d.name, owner_employee_id: null,
      sort_order: d.row.sort_order, code_is_manual: false, created_by: ctx.userId,
    });
    if (ins.error) {
      for (const k of created) await ctx.admin.from("tender_wbs_items").delete().eq("id", k).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
      return ins.error.code === "23505" ? fail(409, "Another change took the next code. Try again") : missing(ins.error) ? { ok: false, ...pending } : fail(500, ins.error.message);
    }
    created.push(d.key);
  }
  items = candidate.map((i) => ({ ...i, code: codes.get(i.id) ?? i.code }));

  const old = members.parts.get(boqId) ?? [];
  const now = new Date().toISOString();
  const clear = await ctx.admin.from("tender_wbs_line_parts").delete().eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId).eq("boq_line_id", boqId);
  if (clear.error) return fail(500, clear.error.message);
  if (verdict.kind === "whole") {
    const set = await ctx.admin.from("tender_boq_lines").update({ wbs_item_id: verdict.wbs_item_id, updated_at: now }).eq("id", boqId).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
    if (set.error) return fail(500, set.error.message);
    await ctx.log([{ field: `WBS unsplit ${lineLabel(line)}`, from: null, to: `${labelOf(items, verdict.wbs_item_id)}` }]);
    return { ok: true, kind: "whole", parts: [{ wbs_item_id: verdict.wbs_item_id, share_pct: 100 }], created };
  }
  const ins = await ctx.admin.from("tender_wbs_line_parts").insert(verdict.parts.map((p, i) => ({
    tenant_id: ctx.tenantId, opportunity_id: ctx.opportunityId, boq_line_id: boqId, wbs_item_id: p.wbs_item_id, share_pct: p.share_pct, sort_order: i,
  })));
  if (ins.error) {
    if (old.length > 0) {
      await ctx.admin.from("tender_wbs_line_parts").insert(old.map((p, i) => ({ tenant_id: ctx.tenantId, opportunity_id: ctx.opportunityId, boq_line_id: boqId, wbs_item_id: p.wbs_item_id, share_pct: p.share_pct, sort_order: i })));
    }
    return missing(ins.error) ? { ok: false, ...pending } : fail(500, ins.error.message);
  }
  const set = await ctx.admin.from("tender_boq_lines").update({ wbs_item_id: null, updated_at: now }).eq("id", boqId).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
  if (set.error) return fail(500, set.error.message);
  await ctx.log([{ field: `WBS split ${lineLabel(line)}`, from: old.length > 0 ? old.map((p) => `${labelOf(st.items, p.wbs_item_id)} ${pctText(p.share_pct)} %`).join(" · ") : null, to: verdict.parts.map((p) => `${labelOf(items, p.wbs_item_id)} ${pctText(p.share_pct)} %`).join(" · ") }]);
  return { ok: true, kind: "parts", parts: verdict.parts, created };
}

/** Unsplit: the whole line goes to the named item, else to the item of its first part. */
export async function unsplitLine(ctx: WbsCtx, boqId: string, itemRaw?: unknown): Promise<Result<{ wbs_item_id: string }>> {
  const line = await lineOf(ctx, boqId);
  if (!line) return fail(404, "Line not found");
  if (itemRaw != null && itemRaw !== "" && !isUuid(itemRaw)) return fail(422, "That is not a WBS item");
  const st = await load(ctx);
  if (!st.ok) return st;
  const { items, members } = st;
  const parts = members.parts.get(boqId) ?? [];
  if (parts.length === 0) return fail(422, "That line is not split");
  const target = typeof itemRaw === "string" && itemRaw ? itemRaw : parts[0].wbs_item_id;
  if (!items.some((i) => i.id === target)) return fail(404, "WBS item not found");
  if (!isLeaf(items, target)) return fail(422, `${labelOf(items, target)} has sub-items. Choose one of them`);
  const err = await writeAssign(ctx, [boqId], target);
  if (err) return fail(500, err);
  await ctx.log([{ field: `WBS unsplit ${lineLabel(line)}`, from: parts.map((p) => `${labelOf(items, p.wbs_item_id)} ${pctText(p.share_pct)} %`).join(" · "), to: labelOf(items, target) }]);
  return { ok: true, wbs_item_id: target };
}

/**
 * Renumber: the auto-numbered codes are recomputed (1, 1.1, 1.1.1); a code a person typed is kept. With `all`, every code is recomputed and the typed
 * flag is cleared too. The screen asks before calling this.
 */
export async function renumberItems(ctx: WbsCtx, opts: { all?: boolean } = {}): Promise<Result<{ changed: number }>> {
  const st = await load(ctx);
  if (!st.ok) return st;
  if (!opts.all) {
    const keep = codeChanges(st.items);
    const err = await applyCodes(ctx, keep.map((c) => ({ id: c.id, to: c.to })));
    if (err) return fail(500, err);
    if (keep.length > 0) await ctx.log([{ field: "WBS renumbered", from: null, to: `${keep.length} code${keep.length === 1 ? "" : "s"}` }]);
    return { ok: true, changed: keep.length };
  }
  const changes = renumberAll(st.items);
  // An item that was typed but already carries its computed code only needs the flag cleared.
  const flagOnly = st.items.filter((i) => i.code_is_manual && !changes.some((c) => c.id === i.id));
  const err = await applyCodes(ctx, changes.map((c) => ({ id: c.id, to: c.to, manual_cleared: c.manual_cleared })));
  if (err) return fail(500, err);
  for (const i of flagOnly) await ctx.admin.from("tender_wbs_items").update({ code_is_manual: false, updated_at: new Date().toISOString() }).eq("id", i.id).eq("tenant_id", ctx.tenantId).eq("opportunity_id", ctx.opportunityId);
  if (changes.length + flagOnly.length > 0) await ctx.log([{ field: "WBS renumbered", from: null, to: `${changes.length} code${changes.length === 1 ? "" : "s"}` }]);
  return { ok: true, changed: changes.length };
}

// ── The answer a screen or the API reads ────────────────────────────────────────────────────────────────────────────

/** The WBS of a deal for the lines the caller already has (the BOQ screen's own state): items in order, roll-ups, total. */
export async function wbsStateFor(admin: SupabaseClient, tenantId: string, oppId: string, lines: readonly BoqFigureLine[]): Promise<{ state: WbsState; members: LineMembers }> {
  const [it, mem] = await Promise.all([loadItems(admin, tenantId, oppId), loadMembers(admin, tenantId, oppId)]);
  if (it.pending || mem.pending) return { state: { pending: true, items: [], rollup: {}, total: { part_count: 0, shared_count: 0, client_amount: 0, cost: null, priced_count: 0 } }, members: mem.members };
  const names = await ownerNames(admin, tenantId, it.items);
  return { state: buildWbsState(it.items, names, lines, mem.members), members: mem.members };
}
