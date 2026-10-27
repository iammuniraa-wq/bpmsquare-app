// The pure part of the rate-sheet screen: what a row's chip says, which rows a filter shows, and how the person's choices turn into the
// request. No React, so a test holds it.

import type { Decision, PreviewRow, RowOutcome, RowStatus } from "./plan";
import type { SkippedRateRow } from "./parse";

/** What the preview call answers. */
export type PreviewView = {
  file: string;
  sheet: string | null;
  header_row: number;
  columns: { field: string; label: string; column: number }[];
  today: string;
  sheet_date: string;
  currency: string | null;
  validity_days: number;
  rows: PreviewRow[];
  skipped: SkippedRateRow[];
  skipped_total: number;
  truncated: boolean;
  counts: { rows: number; ready: number; needs_choice: number; not_applied: number; stale: number };
};

/** What the apply call answers. */
export type ApplyView = {
  summary: { updated: number; added: number; unchanged: number; skipped: number; errors: number; stale: number };
  /** Only the rows that did not simply succeed (errors and unchanged), so the answer stays small. */
  notes: RowOutcome[];
  validity_days: number;
};

/** A row's choice in the select: "skip", "add", or "update:<product id>". */
export type Choice = string;

export const STATUS_LABEL: Record<RowStatus, string> = {
  exact: "Exact match", strong: "Close match", possible: "Possible match", none: "No match", blocked: "Not applied", duplicate: "Repeated row",
};
export const STATUS_TONE: Record<RowStatus, "green" | "teal" | "amber" | "blue" | "red"> = {
  exact: "green", strong: "teal", possible: "amber", none: "blue", blocked: "red", duplicate: "red",
};

export type RowFilter = "choose" | "ready" | "not_applied" | "all";
export const FILTER_LABEL: Record<RowFilter, string> = { choose: "Need a choice", ready: "Ready", not_applied: "Not applied", all: "All" };

export const isFixed = (r: Pick<PreviewRow, "status">) => r.status === "blocked" || r.status === "duplicate";

/** What the person gets for a row if they change nothing. */
export function defaultChoices(rows: readonly PreviewRow[]): Record<number, Choice> {
  const out: Record<number, Choice> = {};
  for (const r of rows) out[r.row_no] = r.default_action === "update" && r.default_product_id ? `update:${r.default_product_id}` : "skip";
  return out;
}

/** Which group a row sits in. It depends on the row, not on the current choice, so a row does not jump between lists as you choose. */
export function rowFilter(r: PreviewRow): RowFilter {
  if (isFixed(r)) return "not_applied";
  return r.default_action === "update" ? "ready" : "choose";
}

export function filterRows(rows: readonly PreviewRow[], filter: RowFilter): PreviewRow[] {
  return filter === "all" ? [...rows] : rows.filter((r) => rowFilter(r) === filter);
}

export function countFilters(rows: readonly PreviewRow[]): Record<RowFilter, number> {
  const c: Record<RowFilter, number> = { choose: 0, ready: 0, not_applied: 0, all: rows.length };
  for (const r of rows) c[rowFilter(r)]++;
  return c;
}

export function toDecisions(choices: Readonly<Record<number, Choice>>): Decision[] {
  const out: Decision[] = [];
  for (const [k, v] of Object.entries(choices)) {
    const row = Number(k);
    if (v.startsWith("update:")) out.push({ row, action: "update", product_id: v.slice(7) });
    else if (v === "add") out.push({ row, action: "add" });
    else out.push({ row, action: "skip" });
  }
  return out;
}

/** How many rows would change the catalogue. */
export const changeCount = (choices: Readonly<Record<number, Choice>>): number => Object.values(choices).filter((v) => v !== "skip").length;

/** Every row that has no match and no choice yet, set to "add as new item" (or back to "skip"). */
export function setUnmatched(rows: readonly PreviewRow[], choices: Readonly<Record<number, Choice>>, to: "add" | "skip"): Record<number, Choice> {
  const out = { ...choices };
  for (const r of rows) if (r.status === "none") out[r.row_no] = to;
  return out;
}
