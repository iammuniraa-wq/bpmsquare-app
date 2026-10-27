import { canAddCustom, customKindFromLabel, kindLabel } from "@/lib/middleware/mapping/valueLists";
import type { ValueListRow } from "@/lib/middleware/mapping/types";
import { isOrgKind, orgKeyLabel, parseOrgKey, salesAreaProblem, type OrgNames } from "@/lib/middleware/erpOrgPure";
import type { OrgDirectoryView, ProposedList, ValueListView } from "./api";

// The Value mapping view's pure parts. A list is a two-column table, BPMSquare value | ERP code, used outbound and, reversed,
// inbound. Exactly one row per ERP code is the answer when that code comes back: the row marked "In".

export type ListDraft = { kind: string; label: string; rows: ValueListRow[]; default_in: string | null; isNew?: boolean };

export const draftOf = (l: Pick<ValueListView, "kind" | "label" | "rows" | "default_in">): ListDraft => ({
  kind: l.kind, label: l.label, rows: l.rows.map((r) => ({ ...r })), default_in: l.default_in,
});
export const draftOfProposed = (l: ProposedList): ListDraft => ({ kind: l.kind, label: l.label, rows: normalizeInbound(l.rows.map((r) => ({ ...r }))), default_in: l.default_in, isNew: true });

const norm = (s: string) => s.trim().toLowerCase();

/** One inbound row per ERP code: the first marked one wins, else the first row of the code. A row with no code is never inbound. */
export function normalizeInbound(rows: ValueListRow[]): ValueListRow[] {
  const winner = new Map<string, number>();
  rows.forEach((r, i) => {
    const code = r.erp.trim();
    if (!code) return;
    const cur = winner.get(code);
    if (cur === undefined || (r.inbound && !rows[cur].inbound)) winner.set(code, i);
  });
  return rows.map((r, i) => ({ ...r, inbound: r.erp.trim() !== "" && winner.get(r.erp.trim()) === i }));
}

export const cleanListRows = (rows: readonly ValueListRow[]): ValueListRow[] =>
  normalizeInbound(rows.filter((r) => r.bpm.trim() || r.erp.trim()).map((r) => ({ bpm: r.bpm.trim(), erp: r.erp.trim(), inbound: r.inbound })));

export const isListDirty = (base: ListDraft | null, now: ListDraft): boolean =>
  !base || JSON.stringify([cleanListRows(base.rows), base.default_in]) !== JSON.stringify([cleanListRows(now.rows), now.default_in]);

export const addRow = (d: ListDraft, bpm = ""): ListDraft => ({ ...d, rows: [...d.rows, { bpm, erp: "", inbound: false }] });
export const removeRow = (d: ListDraft, i: number): ListDraft => ({ ...d, rows: normalizeInbound(d.rows.filter((_, j) => j !== i)) });
export const setBpm = (d: ListDraft, i: number, bpm: string): ListDraft => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, bpm } : r)) });
export const setErp = (d: ListDraft, i: number, erp: string): ListDraft =>
  ({ ...d, rows: normalizeInbound(d.rows.map((r, j) => (j === i ? { ...r, erp, inbound: r.inbound } : r))) });

/** Make row i the answer for its ERP code. */
export function setInbound(d: ListDraft, i: number): ListDraft {
  const code = d.rows[i]?.erp.trim();
  if (!code) return d;
  return { ...d, rows: d.rows.map((r, j) => (r.erp.trim() === code ? { ...r, inbound: j === i } : r)) };
}

/** A row with a BPMSquare value and no ERP code: shown red, blocks the send of that value (not the save). */
export const needsCode = (r: ValueListRow): boolean => r.bpm.trim() !== "" && r.erp.trim() === "";

/** `col` says which cell the message belongs under; the BPMSquare cell is the default. */
export type RowProblem = { row: number; message: string; col?: "erp" };
export function listProblems(d: ListDraft): RowProblem[] {
  const seen = new Map<string, number>();
  const out: RowProblem[] = [];
  const org = isOrgKind(d.kind);
  d.rows.forEach((r, i) => {
    if (org) {
      // A sales area / company row has a picked coverage or order type, never typed text; a typed code in a row with no pick cannot save.
      if (!r.bpm.trim() && r.erp.trim()) out.push({ row: i, message: "Pick a coverage or an order type for this row." });
      if (d.kind === "sales_area") {
        const p = salesAreaProblem(r.erp);
        if (p) out.push({ row: i, message: p, col: "erp" });
      }
    }
    const b = norm(r.bpm);
    if (!b) return;
    const first = seen.get(b);
    if (first !== undefined) out.push({ row: i, message: `${r.bpm.trim()} is already in row ${first + 1}.` });
    else seen.set(b, i);
  });
  return out;
}

export const defaultChoices = (d: ListDraft): string[] => [...new Set(d.rows.map((r) => r.bpm.trim()).filter(Boolean))];

/** Rows from a proposal that this list does not have yet (by ERP code), appended. */
export function mergeProposed(d: ListDraft, proposed: readonly ValueListRow[]): { draft: ListDraft; added: number } {
  const have = new Set(d.rows.map((r) => r.erp.trim()).filter(Boolean));
  const add = proposed.filter((r) => r.erp.trim() && !have.has(r.erp.trim()));
  return { draft: { ...d, rows: normalizeInbound([...d.rows, ...add.map((r) => ({ ...r }))]) }, added: add.length };
}

/** A value that failed or came back unknown, as a new row to fill in. */
export function addMissingValue(d: ListDraft, side: "out" | "in", value: string): ListDraft {
  if (d.rows.some((r) => norm(side === "out" ? r.bpm : r.erp) === norm(value))) return d;
  return { ...d, rows: [...d.rows, side === "out" ? { bpm: value, erp: "", inbound: false } : { bpm: "", erp: value, inbound: true }] };
}

export function counterLine(c: { rows: number; unused: number; unmapped: number }): string {
  return [`${c.rows} row${c.rows === 1 ? "" : "s"}`, ...(c.unused ? [`${c.unused} unused`] : []), ...(c.unmapped ? [`${c.unmapped} unmapped`] : [])].join(" · ");
}

export const addableKinds = (standard: readonly { kind: string; label: string; created: boolean }[], drafts: readonly string[]) =>
  standard.filter((k) => !k.created && !drafts.includes(k.kind));

/** A custom list from a label: its kind, or why it cannot be made. */
export function newCustomList(label: string, existing: readonly string[]): { kind: string; label: string } | { problem: string } {
  const kind = customKindFromLabel(label);
  if (!kind) return { problem: "Give the list a name." };
  if (existing.includes(kind)) return { problem: `${kindLabel(kind)} already exists.` };
  if (!canAddCustom([...existing])) return { problem: "A connection holds at most 20 custom lists." };
  return { kind, label: label.trim().slice(0, 60) };
}

export const emptyDraft = (kind: string, label?: string): ListDraft => ({ kind, label: label ?? kindLabel(kind), rows: [], default_in: null, isNew: true });

// ── Sales area / ERP company lists: the BPMSquare side is picked, and shown by name ──────────

export type OrgChoice = { key: string; label: string; group: "Coverage" | "Order type" };

/** The pick list for one row: every coverage and order type not used by another row, plus this row's own (even when it was removed). */
export function orgChoicesForRow(org: OrgDirectoryView, d: ListDraft, i: number): { choices: OrgChoice[]; own: (OrgChoice & { removed: boolean }) | null } {
  const mine = d.rows[i]?.bpm.trim().toLowerCase() ?? "";
  const used = new Set(d.rows.filter((_, j) => j !== i).map((r) => r.bpm.trim().toLowerCase()).filter(Boolean));
  const choices = org.options.filter((o) => !used.has(o.key.toLowerCase()));
  const own = mine && !choices.some((o) => o.key.toLowerCase() === mine)
    ? { key: d.rows[i].bpm, ...orgKeyLabel(d.rows[i].bpm, org.names as OrgNames) }
    : null;
  return { choices, own };
}

/** Rows whose coverage or order type no longer exists: the list says so, and the person deletes them. */
export const removedOrgRows = (d: ListDraft, names: OrgNames): number =>
  d.rows.filter((r) => parseOrgKey(r.bpm) && orgKeyLabel(r.bpm, names).removed).length;

export const orgPlaceholder = (kind: string): string => (kind === "sales_area" ? "1000/10/00" : "Company or business unit");

export function csvPreviewLine(p: { added: number; changed: number; removed: number }): string {
  const parts = [`${p.added} added`, `${p.changed} changed`, `${p.removed} removed`];
  return `The file would change this list: ${parts.join(", ")}.`;
}
