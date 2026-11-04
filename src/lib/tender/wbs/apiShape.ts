import {
  divideByShares, partsOf, remainderOf, rollupFigures, SHARE_TOLERANCE, totalOf, treeOrder,
  type Membership, type RollLine, type Share, type TreeItem,
} from "@/lib/wbs/tree";
import type { QueryableField } from "@/lib/api/query";
import type { LineMembers, WbsItemRow } from "./types";

// The WBS as a machine or a file sees it (Data Workbench, the v1 API, the MCP tool). PURE, so the tests and the routes share one set of rules.
//
// ONE text format for where a BOQ line sits, on every surface: a whole line is its item's code ("2.1"); a split line is the list
// "code:percent" joined by ";" ("2.1:60;2.2:15;2.3:25"); an unassigned line is empty. Nothing here ever carries a cost, a unit cost or a
// margin: a part has a share, a quantity and a CLIENT amount.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** A share as written in a cell: no trailing zeros ("60", "12.5"). */
export const pctCell = (n: number): string => String(round4(n));

/** Where a line sits, as one cell: empty (unassigned), a code (whole line), or "code:percent;code:percent" (split, or a remainder after an item was removed). */
export function wbsCodeText(shares: readonly Share[], codeOf: (itemId: string) => string | undefined): string {
  if (shares.length === 0) return "";
  const whole = shares.length === 1 && Math.abs(shares[0].share_pct - 100) <= SHARE_TOLERANCE;
  if (whole) return codeOf(shares[0].wbs_item_id) ?? "";
  return shares.map((s) => `${codeOf(s.wbs_item_id) ?? "?"}:${pctCell(s.share_pct)}`).join(";");
}

/** `partial` is set when the only thing wrong is the sum: the shares that were named, so a caller can tell an unchanged left-over from a mistake. */
export type WbsCell = { ok: true; kind: "clear" } | { ok: true; kind: "shares"; shares: Share[] } | { ok: false; error: string; partial?: Share[] };

const shareNumber = (raw: string): number | null => {
  const t = raw.replace(/%/g, "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Reads a cell back. Empty = unassigned. A code alone = the whole line in that item. "code:percent;code:percent" = a split, and it must add up
 * to 100 (within 0.01). An unknown code, a repeated code, a share that is not a number and a sum that is not 100 each give a message for the row.
 * Whether the item may hold lines (it must be a leaf) is the writer's rule, not this parser's.
 */
export function parseWbsCell(text: string, items: readonly Pick<TreeItem, "id" | "code">[]): WbsCell {
  const raw = text.trim();
  if (!raw) return { ok: true, kind: "clear" };
  const byCode = new Map(items.map((i) => [i.code, i]));
  const lower = new Map<string, Pick<TreeItem, "id" | "code">[]>();
  for (const i of items) lower.set(i.code.toLowerCase(), [...(lower.get(i.code.toLowerCase()) ?? []), i]);
  const find = (code: string) => byCode.get(code) ?? (lower.get(code.toLowerCase())?.length === 1 ? lower.get(code.toLowerCase())![0] : undefined);

  // A code that happens to contain ":" is still a whole-line code when it is exactly an item's code.
  const whole = find(raw);
  if (whole) return { ok: true, kind: "shares", shares: [{ wbs_item_id: whole.id, share_pct: 100 }] };

  const entries = raw.split(";").map((e) => e.trim()).filter(Boolean);
  const shares: Share[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const cut = entry.lastIndexOf(":");
    if (cut < 0) {
      if (entries.length === 1) return { ok: false, error: `WBS ${entry} does not exist on this tender` };
      return { ok: false, error: `WBS ${entry} needs a share, like ${entry}:60` };
    }
    const code = entry.slice(0, cut).trim();
    const pct = shareNumber(entry.slice(cut + 1));
    if (!code) return { ok: false, error: `"${entry}" has no WBS code` };
    if (pct === null) return { ok: false, error: `WBS ${code}: "${entry.slice(cut + 1).trim()}" is not a share` };
    const item = find(code);
    if (!item) return { ok: false, error: `WBS ${code} does not exist on this tender` };
    if (seen.has(item.id)) return { ok: false, error: `WBS ${item.code} appears twice` };
    seen.add(item.id);
    if (pct <= 0) return { ok: false, error: "Every WBS share must be more than 0 %" };
    shares.push({ wbs_item_id: item.id, share_pct: pct });
  }
  if (shares.length === 0) return { ok: true, kind: "clear" };
  const sum = round4(shares.reduce((s, p) => s + p.share_pct, 0));
  if (Math.abs(sum - 100) > SHARE_TOLERANCE) return { ok: false, error: `WBS shares add up to ${pctCell(sum)} %, not 100 %`, partial: shares };
  return { ok: true, kind: "shares", shares };
}

/** Do two sets of shares put the line in the same places in the same amounts? (Order does not matter.) */
export function sameShares(a: readonly Share[], b: readonly Share[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x) => b.some((y) => y.wbs_item_id === x.wbs_item_id && Math.abs(y.share_pct - x.share_pct) <= SHARE_TOLERANCE));
}

// ── A BOQ row's WBS columns ─────────────────────────────────────────────────────────────────────────────────────────

export type ApiLinePart = { wbs_code: string; share_pct: number; quantity: number; amount: number | null };

/** The two WBS fields of a BOQ row: `wbs_code` (the cell text, null when unassigned) and `wbs_parts` (empty for a whole line). */
export function annotator(items: readonly Pick<TreeItem, "id" | "code">[], members: LineMembers | null): (boqId: string, quantity: number, amount: number | null) => { wbs_code: string | null; wbs_parts: ApiLinePart[] } {
  const codes = new Map(items.map((i) => [i.id, i.code]));
  const codeOf = (id: string) => codes.get(id);
  return (boqId, quantity, amount) => {
    const m: Membership = { wbs_item_id: members?.item.get(boqId) ?? null, parts: members?.parts.get(boqId) ?? [] };
    // A part whose item is gone cannot happen (the foreign key cascades); one that is not in the list is skipped rather than printed as "?".
    const shares = partsOf(m).filter((s) => codes.has(s.wbs_item_id));
    const text = wbsCodeText(shares, codeOf);
    if (m.parts.length === 0) return { wbs_code: text || null, wbs_parts: [] };
    const pcts = shares.map((s) => s.share_pct);
    const qtys = divideByShares(quantity, pcts);
    const amts = amount == null ? null : divideByShares(amount, pcts);
    return {
      wbs_code: text || null,
      wbs_parts: shares.map((s, i) => ({ wbs_code: codeOf(s.wbs_item_id) as string, share_pct: s.share_pct, quantity: qtys[i], amount: amts ? amts[i] : null })),
    };
  };
}

// ── The tree as /api/v1/tenders/{id}/wbs answers it ─────────────────────────────────────────────────────────────────

export type ApiItemPart = { boq_line_id: string; item_no: string | null; share_pct: number; quantity: number; amount: number | null; status: string };

/** One item of the WBS: the tree position, the owner's NAME, the roll-up of its lines and sub-items (client amounts only), and its own parts. */
export type ApiWbsItem = {
  id: string;
  tender_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  parent_code: string | null;
  level: number;
  owner_name: string | null;
  note: string | null;
  line_count: number;
  shared_count: number;
  priced_count: number;
  client_amount: number;
  parts: ApiItemPart[];
};

/** What the WBS endpoint may name. A test holds this list against the loader's output and against any cost word. */
export const TENDER_WBS_FIELDS: QueryableField[] = [
  { path: "id", type: "string" }, { path: "tender_id", type: "string" }, { path: "code", type: "string", searchable: true }, { path: "name", type: "string", searchable: true },
  { path: "parent_id", type: "string" }, { path: "parent_code", type: "string" }, { path: "level", type: "number" }, { path: "owner_name", type: "string" },
  { path: "note", type: "string" }, { path: "line_count", type: "number" }, { path: "shared_count", type: "number" }, { path: "priced_count", type: "number" },
  { path: "client_amount", type: "number" }, { path: "parts", type: "string" },
];

/** The slice of an already-loaded BOQ API row the WBS needs (status and amounts are the customer-safe ones). */
export type WbsApiRow = Record<string, unknown>;

export type WbsApiAnswer = {
  items: ApiWbsItem[];
  /** The employee behind each item's owner, for the Data Workbench export only; never part of the API answer. */
  ownerIds: Map<string, string | null>;
  total: { line_count: number; shared_count: number; client_amount: number };
  unassigned: { lines: number; client_amount: number };
};

export function buildWbsApi(opportunityId: string, items: readonly WbsItemRow[], names: ReadonlyMap<string, string>, rows: readonly WbsApiRow[], members: LineMembers): WbsApiAnswer {
  const ordered = treeOrder(items);
  const codeById = new Map(items.map((i) => [i.id, i.code]));
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  // No unit cost is ever passed: the roll-up's cost stays null and is not read below.
  const rollLines: RollLine[] = rows.map((r) => {
    const m: Membership = { wbs_item_id: members.item.get(String(r.id)) ?? null, parts: members.parts.get(String(r.id)) ?? [] };
    const priced = r.status === "priced" || r.status === "stale";
    return { id: String(r.id), qty: num(r.quantity), amount: priced ? num(r.amount) : 0, cost: null, priced, removed: r.status === "removed", ...m };
  });
  const rolled = rollupFigures(items, rollLines);
  const total = totalOf(items, rolled);

  const ownParts = new Map<string, ApiItemPart[]>();
  for (const r of rows) {
    const m: Membership = { wbs_item_id: members.item.get(String(r.id)) ?? null, parts: members.parts.get(String(r.id)) ?? [] };
    const shares = partsOf(m);
    if (shares.length === 0) continue;
    const pcts = shares.map((s) => s.share_pct);
    const qtys = divideByShares(num(r.quantity), pcts);
    const amts = typeof r.amount === "number" ? divideByShares(r.amount, pcts) : null;
    shares.forEach((s, i) => {
      const list = ownParts.get(s.wbs_item_id) ?? [];
      list.push({ boq_line_id: String(r.id), item_no: typeof r.item_no === "string" ? r.item_no : null, share_pct: s.share_pct, quantity: qtys[i], amount: amts ? amts[i] : null, status: String(r.status ?? "") });
      ownParts.set(s.wbs_item_id, list);
    });
  }

  const ownerIds = new Map<string, string | null>();
  const out: ApiWbsItem[] = ordered.map((i) => {
    const f = rolled.get(i.id);
    ownerIds.set(i.id, i.owner_employee_id);
    return {
      id: i.id, tender_id: opportunityId, code: i.code, name: i.name, parent_id: i.parent_id, parent_code: i.parent_id ? codeById.get(i.parent_id) ?? null : null,
      level: i.depth, owner_name: i.owner_employee_id ? names.get(i.owner_employee_id) ?? null : null, note: i.note,
      line_count: f?.part_count ?? 0, shared_count: f?.shared_count ?? 0, priced_count: f?.priced_count ?? 0, client_amount: round2(f?.client_amount ?? 0),
      parts: ownParts.get(i.id) ?? [],
    };
  });

  // Lines (or the left-over share of a split line) that sit in no item. A line no longer in the file is not counted.
  let unassignedLines = 0;
  let unassignedAmount = 0;
  for (const l of rollLines) {
    if (l.removed) continue;
    const rest = remainderOf(l);
    if (rest <= 0) continue;
    unassignedLines += 1;
    unassignedAmount += (l.amount * rest) / 100;
  }
  return {
    items: out, ownerIds,
    total: { line_count: total.part_count, shared_count: total.shared_count, client_amount: round2(total.client_amount) },
    unassigned: { lines: unassignedLines, client_amount: round2(unassignedAmount) },
  };
}
