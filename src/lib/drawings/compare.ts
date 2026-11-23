import { COMPARED_FIELDS, type ChangeSummary, type ComparedField } from "./types";

// The comparison of two revisions' elements (docs/design/pcbs-drawing-register.md section 5). Pure and deterministic: no AI, no money.
// Matching is by model_uid first, then by element_code; an element that has neither is listed as "not matched" and never guessed.
// Quantities are PER PIECE (qty is the number of pieces); totals multiply by qty.

export type CompareEl = {
  model_uid: string | null;
  element_code: string | null;
  element_type: string | null;
  building: string | null;
  level: string | null;
  qty: number;
  unit: string | null;
  volume_m3: number | null;
  area_m2: number | null;
  length_m: number | null;
  weight_t: number | null;
};

export type FieldChange = { field: ComparedField; from: string | number | null; to: string | number | null };
export type CompareRow =
  | { kind: "added"; key: string; to: CompareEl }
  | { kind: "removed"; key: string; from: CompareEl }
  | { kind: "changed"; key: string; from: CompareEl; to: CompareEl; changes: FieldChange[] }
  | { kind: "unchanged"; key: string; from: CompareEl; to: CompareEl };

export type GroupTotals = { key: string; building: string; element_type: string; count_from: number; count_to: number; volume_from: number; volume_to: number; weight_from: number; weight_to: number };

export type Comparison = {
  rows: CompareRow[];
  /** Elements with neither a model id nor a code, on either side: shown for a person to deal with. */
  notMatched: { side: "from" | "to"; element: CompareEl }[];
  counts: { added: number; removed: number; changed: number; unchanged: number; notMatched: number };
  groups: GroupTotals[];
  totals: { count_from: number; count_to: number; volume_from: number; volume_to: number; weight_from: number; weight_to: number };
};

const EPS = 1e-6;
const blank = (v: unknown): boolean => v == null || (typeof v === "string" && v.trim() === "");
const same = (a: unknown, b: unknown): boolean => {
  if (blank(a) && blank(b)) return true;
  if (blank(a) || blank(b)) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= EPS;
  return String(a).trim() === String(b).trim();
};

export function diffFields(from: CompareEl, to: CompareEl): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of COMPARED_FIELDS) {
    const a = from[f] as string | number | null, b = to[f] as string | number | null;
    if (!same(a, b)) out.push({ field: f, from: a ?? null, to: b ?? null });
  }
  return out;
}

const keyOf = (e: CompareEl): string => e.model_uid ? `uid:${e.model_uid}` : e.element_code ? `code:${e.element_code}` : "";
const piece = (v: number | null, qty: number): number => (v == null ? 0 : v * qty);

export function compareElements(from: readonly CompareEl[], to: readonly CompareEl[]): Comparison {
  const rows: CompareRow[] = [];
  const notMatched: Comparison["notMatched"] = [];
  const byUid = new Map<string, number>();
  const byCode = new Map<string, number[]>();
  const taken = new Set<number>();
  from.forEach((e, i) => {
    if (!keyOf(e)) { notMatched.push({ side: "from", element: e }); taken.add(i); return; }
    if (e.model_uid && !byUid.has(e.model_uid)) byUid.set(e.model_uid, i);
    if (e.element_code) byCode.set(e.element_code, [...(byCode.get(e.element_code) ?? []), i]);
  });

  for (const t of to) {
    if (!keyOf(t)) { notMatched.push({ side: "to", element: t }); continue; }
    let idx: number | undefined;
    if (t.model_uid && byUid.has(t.model_uid) && !taken.has(byUid.get(t.model_uid)!)) idx = byUid.get(t.model_uid);
    if (idx === undefined && t.element_code) {
      // By code only when the two do not carry different model ids (two ids = two different elements, never guessed to be one).
      idx = (byCode.get(t.element_code) ?? []).find((i) => !taken.has(i) && !(t.model_uid && from[i].model_uid && t.model_uid !== from[i].model_uid));
    }
    if (idx === undefined) { rows.push({ kind: "added", key: keyOf(t), to: t }); continue; }
    taken.add(idx);
    const f = from[idx];
    const changes = diffFields(f, t);
    rows.push(changes.length ? { kind: "changed", key: keyOf(t), from: f, to: t, changes } : { kind: "unchanged", key: keyOf(t), from: f, to: t });
  }
  from.forEach((e, i) => { if (!taken.has(i)) rows.push({ kind: "removed", key: keyOf(e), from: e }); });

  const counts = {
    added: rows.filter((r) => r.kind === "added").length, removed: rows.filter((r) => r.kind === "removed").length,
    changed: rows.filter((r) => r.kind === "changed").length, unchanged: rows.filter((r) => r.kind === "unchanged").length, notMatched: notMatched.length,
  };

  const groups = new Map<string, GroupTotals>();
  const add = (e: CompareEl, side: "from" | "to") => {
    const building = e.building?.trim() || "No building", type = e.element_type?.trim() || "No type";
    const key = `${building}\u0000${type}`;
    const g = groups.get(key) ?? { key, building, element_type: type, count_from: 0, count_to: 0, volume_from: 0, volume_to: 0, weight_from: 0, weight_to: 0 };
    g[`count_${side}`] += e.qty;
    g[`volume_${side}`] += piece(e.volume_m3, e.qty);
    g[`weight_${side}`] += piece(e.weight_t, e.qty);
    groups.set(key, g);
  };
  from.forEach((e) => add(e, "from"));
  to.forEach((e) => add(e, "to"));
  const list = [...groups.values()].sort((a, b) => a.building.localeCompare(b.building) || a.element_type.localeCompare(b.element_type));
  const totals = list.reduce((s, g) => ({
    count_from: s.count_from + g.count_from, count_to: s.count_to + g.count_to, volume_from: s.volume_from + g.volume_from, volume_to: s.volume_to + g.volume_to,
    weight_from: s.weight_from + g.weight_from, weight_to: s.weight_to + g.weight_to,
  }), { count_from: 0, count_to: 0, volume_from: 0, volume_to: 0, weight_from: 0, weight_to: 0 });
  return { rows, notMatched, counts, groups: list, totals };
}

/** The counts shown as a chip on the revision list. */
export const summaryOf = (c: Comparison): ChangeSummary => ({ added: c.counts.added, removed: c.counts.removed, changed: c.counts.changed, unchanged: c.counts.unchanged });

/** "+3 added, 1 removed, 2 changed" or "no change". */
export function summaryText(s: Pick<ChangeSummary, "added" | "removed" | "changed"> | null | undefined): string {
  if (!s) return "";
  const parts = [s.added ? `${s.added} added` : "", s.removed ? `${s.removed} removed` : "", s.changed ? `${s.changed} changed` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "no change";
}

/** How the BOQ lines that use a group of elements move: the model quantity of a line is the sum of qty of its element_code group. */
export function modelQtyByCode(els: readonly Pick<CompareEl, "element_code" | "qty">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of els) if (e.element_code) m.set(e.element_code, (m.get(e.element_code) ?? 0) + e.qty);
  return m;
}
