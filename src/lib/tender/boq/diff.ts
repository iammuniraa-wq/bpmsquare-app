import type { BoqLine } from "./parse";

// Re-uploading a revised BOQ (slice 3a). PURE. The lines of the new file are matched to the lines already on the deal by their
// key (the item number, else description + unit); the result says what is added, what changed and what is no longer in the
// file. A line that is no longer in the file is dropped only when nobody priced it: a priced line is kept and flagged, because
// somebody's work is in its rate and a revised BOQ is the moment a line is most likely to have been dropped by mistake.

export type ExistingLine = {
  key: string;
  item_no: string | null;
  description: string;
  uom: string | null;
  qty: number;
  cost_code: string | null;
  /** A rate has been set on the deal line. */
  priced: boolean;
  /** Already flagged "not in the latest BOQ" by an earlier upload. */
  removed: boolean;
};

export type ChangedLine = { key: string; line: BoqLine; was: ExistingLine; fields: ChangedField[] };
export type ChangedField = "description" | "unit" | "quantity" | "cost code" | "back in the file";

export type BoqDiff = {
  added: BoqLine[];
  changed: ChangedLine[];
  unchanged: number;
  /** In the deal, not in the file, and not priced: dropped from the deal. */
  dropped: ExistingLine[];
  /** In the deal, not in the file, but priced: kept, flagged. */
  kept: ExistingLine[];
};

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const sameQty = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function diffBoq(existing: readonly ExistingLine[], incoming: readonly BoqLine[]): BoqDiff {
  const have = new Map(existing.map((e) => [e.key, e]));
  const added: BoqLine[] = [];
  const changed: ChangedLine[] = [];
  let unchanged = 0;
  const seen = new Set<string>();

  for (const line of incoming) {
    seen.add(line.key);
    const was = have.get(line.key);
    if (!was) { added.push(line); continue; }
    const fields: ChangedField[] = [];
    if (squash(was.description) !== squash(line.description)) fields.push("description");
    if (squash(was.uom) !== squash(line.uom)) fields.push("unit");
    if (!sameQty(was.qty, line.qty)) fields.push("quantity");
    if (squash(was.cost_code) !== squash(line.cost_code)) fields.push("cost code");
    if (was.removed) fields.push("back in the file");
    if (fields.length > 0) changed.push({ key: line.key, line, was, fields });
    else unchanged++;
  }

  const gone = existing.filter((e) => !seen.has(e.key) && !e.removed);
  return { added, changed, unchanged, dropped: gone.filter((e) => !e.priced), kept: gone.filter((e) => e.priced) };
}

export const diffSummary = (d: BoqDiff): string => {
  const parts = [
    d.added.length ? `${d.added.length} added` : "",
    d.changed.length ? `${d.changed.length} changed` : "",
    d.dropped.length ? `${d.dropped.length} removed` : "",
    d.kept.length ? `${d.kept.length} priced line${d.kept.length === 1 ? "" : "s"} kept although no longer in the file` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No changes";
};

// ── Finding a line again ────────────────────────────────────────────────────────────────────────────────────────────────

// The deal's Lines editor saves by deleting every line and inserting them again, so a BOQ row's link to its deal line (line_id)
// is cleared whenever someone saves there. The next BOQ screen load restores it: first by the item number kept in sl_no (when
// the editor kept it) together with the description, then by the description and unit the file said, then by the description
// alone. A deal line can be claimed once.

export type FreeLine = { id: string; sl_no: string | null; description: string; uom: string | null };
export type OrphanRow = { id: string; item_no: string | null; row_no: number; file_description: string; file_uom: string | null };

const tidy = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const itemTidy = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s.]+$/g, "").replace(/\s+/g, "");

/** boq row id -> deal line id, for the rows that can be matched to a line nobody else has. */
export function relinkPlan(orphans: readonly OrphanRow[], free: readonly FreeLine[]): Map<string, string> {
  const plan = new Map<string, string>();
  const taken = new Set<string>();
  const rows = [...orphans].sort((a, b) => a.row_no - b.row_no);
  const passes: ((o: OrphanRow, l: FreeLine) => boolean)[] = [
    (o, l) => !!itemTidy(o.item_no) && itemTidy(o.item_no) === itemTidy(l.sl_no) && tidy(o.file_description) === tidy(l.description),
    (o, l) => tidy(o.file_description) === tidy(l.description) && tidy(o.file_uom) === tidy(l.uom),
    (o, l) => tidy(o.file_description) === tidy(l.description),
  ];
  for (const pass of passes) {
    for (const o of rows) {
      if (plan.has(o.id)) continue;
      const hit = free.find((l) => !taken.has(l.id) && pass(o, l));
      if (hit) { plan.set(o.id, hit.id); taken.add(hit.id); }
    }
  }
  return plan;
}
