// GCC tender deals, slice 4: bid versions (docs/design/gcc-tender-deals.md section 15). PURE: no I/O and no server imports, so the
// routes, the screen and the tests share one snapshot shape and one comparison.
//
// A bid version is an append-only snapshot of the deal's lines at the moment the bid went in. The snapshot is built from a WHITELIST
// (snapshotLine names every field it keeps), so a cost, a markup, a margin or a pricing flag can never ride along by accident.

import { selectedLines, type SelectableLine } from "@/lib/sales/lineTotals";

export const BID_LIMITS = { reasonMin: 3, reasonMax: 1000, noteMax: 1000 } as const;
/** Stages a bid can be submitted from; Revise bid goes back to Estimating from the other two. */
export const BID_SUBMIT_STAGES: readonly string[] = ["estimating", "clarifications"];
export const BID_REVISE_STAGES: readonly string[] = ["submitted", "clarifications"];

/** One line of a submitted bid. These are the ONLY fields a snapshot keeps. */
export type BidLine = {
  /** Matches the same line across versions: the client's item number, else the wording + unit. Not shown. */
  key: string;
  item_no: string | null;
  description: string;
  unit: string | null;
  qty: number;
  rate: number;
  amount: number;
  /** The catalog product's SKU (or name) when the line is linked to a product. */
  product_ref: string | null;
  /** Where the rate came from: "Supplier", "BOM / estimate", ... (label only, never the figure behind it). */
  price_source: string | null;
};
export const BID_LINE_FIELDS = ["key", "item_no", "description", "unit", "qty", "rate", "amount", "product_ref", "price_source"] as const;

/** A deal line as the snapshot reads it. Extra columns on a real row (cost, flags, ...) are simply never copied. */
export type SnapshotSource = SelectableLine & {
  sl_no?: string | null;
  description: string;
  uom?: string | null;
  qty: number | string;
  rate: number | string;
  discount_pct?: number | string | null;
  product_id?: string | null;
  show_on_pdf?: boolean | null;
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The matching key of a line, made unique inside one bid (repeats get #2, #3). */
export function lineKeys(lines: readonly { item_no: string | null; description: string; unit: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = l.item_no && clean(l.item_no) ? `no:${norm(l.item_no)}` : `tx:${norm(l.description)}|${norm(l.unit ?? "")}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

export type Snapshot = { lines: BidLine[]; total: number; line_count: number };

/**
 * The deal lines as they stand, kept in the order given (the caller passes the client's file order), only the lines that count
 * toward the deal total (a non-chosen alternative and a quantity-break row do not), and only the whitelisted fields.
 */
export function buildSnapshot(
  lines: readonly SnapshotSource[],
  ctx: { productRef?: ReadonlyMap<string, string>; priceSource?: ReadonlyMap<string, string> } = {},
): Snapshot {
  const counted = selectedLines(lines.map((l) => ({ ...l }))) as SnapshotSource[];
  const part = counted.filter((l) => clean(l.description)).map((l) => {
    const qty = num(l.qty);
    const rate = num(l.rate);
    const disc = Math.max(0, Math.min(100, num(l.discount_pct)));
    return {
      item_no: clean(l.sl_no) || null,
      description: clean(l.description),
      unit: clean(l.uom) || null,
      qty, rate,
      // The line's own amount when it has one, else what qty, rate and discount make of it.
      amount: round2(l.amount != null && Number.isFinite(Number(l.amount)) ? Number(l.amount) : qty * rate * (1 - disc / 100)),
      product_ref: l.product_id ? (ctx.productRef?.get(l.product_id) || null) : null,
      price_source: ctx.priceSource?.get(l.id) ?? null,
    };
  });
  const keys = lineKeys(part);
  const out: BidLine[] = part.map((p, i) => snapshotLine({ key: keys[i], ...p }));
  return { lines: out, total: round2(out.reduce((s, l) => s + l.amount, 0)), line_count: out.length };
}

/** Rebuilds a line from the whitelist only. */
export function snapshotLine(l: BidLine): BidLine {
  return {
    key: l.key, item_no: l.item_no ?? null, description: l.description, unit: l.unit ?? null, qty: num(l.qty), rate: num(l.rate),
    amount: num(l.amount), product_ref: l.product_ref ?? null, price_source: l.price_source ?? null,
  };
}

/** Lines read back from the database (jsonb): only well-formed rows, only the whitelisted fields. */
export function parseStoredLines(raw: unknown): BidLine[] {
  if (!Array.isArray(raw)) return [];
  const out: BidLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.description !== "string") continue;
    out.push(snapshotLine({
      key: o.key, item_no: typeof o.item_no === "string" ? o.item_no : null, description: o.description, unit: typeof o.unit === "string" ? o.unit : null,
      qty: num(o.qty), rate: num(o.rate), amount: num(o.amount), product_ref: typeof o.product_ref === "string" ? o.product_ref : null,
      price_source: typeof o.price_source === "string" ? o.price_source : null,
    }));
  }
  return out;
}

// ── Submitting ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type SubmitInput = { revision_reason: string | null; note: string | null };

/** Version 1 needs no reason; every later version must say why the bid was revised. */
export function parseSubmit(body: unknown, versionNo: number): { ok: true; value: SubmitInput } | { ok: false; error: string; code?: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const reason = clean(b.revision_reason);
  const note = clean(b.note);
  if (reason.length > BID_LIMITS.reasonMax) return { ok: false, error: `The reason is too long (${BID_LIMITS.reasonMax} characters at most)` };
  if (note.length > BID_LIMITS.noteMax) return { ok: false, error: `The note is too long (${BID_LIMITS.noteMax} characters at most)` };
  if (versionNo > 1 && reason.length < BID_LIMITS.reasonMin) return { ok: false, error: "Say why the bid is revised", code: "reason_required" };
  return { ok: true, value: { revision_reason: versionNo > 1 ? reason : null, note: note || null } };
}

/** Why a bid cannot be submitted now, or null. */
export function submitProblem(args: { stage: string; outcome: string; lineCount: number }): string | null {
  if (args.outcome !== "open") return "This tender is closed";
  if (!BID_SUBMIT_STAGES.includes(args.stage)) return args.stage === "submitted" ? "This bid is already submitted. Use Revise bid to make a new version" : "A bid is submitted from Estimating or Clarifications";
  if (args.lineCount === 0) return "Add lines to the deal before submitting a bid";
  return null;
}

// ── Comparing two versions ──────────────────────────────────────────────────────────────────────────────────────────

export type BidField = "description" | "unit" | "qty" | "rate";
export type ChangedLine = { key: string; item_no: string | null; before: BidLine; after: BidLine; fields: BidField[]; amount_delta: number };
export type BidDiff = {
  added: BidLine[];
  removed: BidLine[];
  changed: ChangedLine[];
  unchanged: number;
  total_from: number;
  total_to: number;
  /** total_to - total_from. */
  delta: number;
  /** delta as a percent of total_from, to 2 places; null when the older total is 0. */
  delta_pct: number | null;
};

/**
 * What changed from `from` to `to`: lines are matched by their key, so moving a line does not make it "changed". `changed`
 * lists qty, rate, unit and description differences; an amount that moved only because of a rounding does not count.
 */
export function diffBids(from: { lines: readonly BidLine[]; total: number }, to: { lines: readonly BidLine[]; total: number }): BidDiff {
  const before = new Map(from.lines.map((l) => [l.key, l]));
  const after = new Map(to.lines.map((l) => [l.key, l]));
  const added = to.lines.filter((l) => !before.has(l.key));
  const removed = from.lines.filter((l) => !after.has(l.key));
  const changed: ChangedLine[] = [];
  let unchanged = 0;
  for (const a of to.lines) {
    const b = before.get(a.key);
    if (!b) continue;
    const fields: BidField[] = [];
    if (norm(b.description) !== norm(a.description)) fields.push("description");
    if (norm(b.unit ?? "") !== norm(a.unit ?? "")) fields.push("unit");
    if (Math.round(b.qty * 1000) !== Math.round(a.qty * 1000)) fields.push("qty");
    if (Math.round(b.rate * 100) !== Math.round(a.rate * 100)) fields.push("rate");
    if (fields.length === 0) { unchanged += 1; continue; }
    changed.push({ key: a.key, item_no: a.item_no, before: b, after: a, fields, amount_delta: round2(a.amount - b.amount) });
  }
  const delta = round2(to.total - from.total);
  return {
    added, removed, changed, unchanged,
    total_from: round2(from.total), total_to: round2(to.total), delta,
    delta_pct: from.total === 0 ? null : round2((delta / from.total) * 100),
  };
}

/** "+1,200.00 (+2.4%)" style text for a delta; the sign is always shown. */
export function deltaText(delta: number, pct: number | null, fmt: (n: number) => string): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const amount = `${sign}${fmt(Math.abs(delta))}`;
  return pct === null ? amount : `${amount} (${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(2)}%)`;
}

// ── What the screens are given ──────────────────────────────────────────────────────────────────────────────────────

export type BidVersionSummary = {
  id: string;
  version_no: number;
  submitted_at: string;
  submitted_by_name: string | null;
  currency: string | null;
  total: number;
  line_count: number;
  revision_reason: string | null;
  note: string | null;
};

export type BidsData = {
  /** Newest first. */
  versions: BidVersionSummary[];
  /** 0225 has not been applied yet. */
  pending: boolean;
  /** The deal lines' total right now (what the next version would carry). */
  working_total: number;
  canEdit: boolean;
};
