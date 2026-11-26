import { CONDITIONS, RECEIPT_SOURCES, SITE_LIMITS, isReasonCode, isUuid, reasonLabel, type Condition, type ReceiptOutcome, type ReceiptSource } from "./types";
import { round2, type Cleaned } from "./expenseRules";

// The rules of a site receipt, pure: what a person who counted a delivery must have said, how the outcome follows from the lines, and what the
// shortfall is. A receipt creates no cost. Quantities are the site's evidence; the word is "received on site", never "progress" or "installed".

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const EPS = 1e-6;
const q = (n: number): number => Math.round(n * 1000) / 1000;

export type ReceiptLineInput = {
  line_key: string | null;
  element_code: string | null;
  building: string | null;
  description: string;
  uom: string | null;
  qty_expected: number | null;
  qty_received: number;
  qty_accepted: number;
  qty_rejected: number;
  condition: Condition;
  reason_code: string | null;
  note: string | null;
};

export type ReceiptInput = {
  client_id: string;
  project_id: string;
  package_id: string | null;
  delivery_note_ref: string | null;
  source_type: ReceiptSource;
  source_id: string | null;
  received_at: string;
  handed_by: string | null;
  vehicle: string | null;
  note: string | null;
  lines: ReceiptLineInput[];
};

/** How a line stands against what was expected. A short line may also be damaged; the worst reading wins for the badge. */
export type LineState = "ok" | "short" | "over" | "rejected" | "damaged";
export function lineState(l: Pick<ReceiptLineInput, "qty_expected" | "qty_received" | "qty_accepted" | "qty_rejected" | "condition">): LineState {
  if (l.qty_received > EPS && l.qty_rejected >= l.qty_received - EPS) return "rejected";
  if (l.qty_rejected > EPS) return "rejected";
  if (l.condition !== "ok") return "damaged";
  if (l.qty_expected !== null && l.qty_received < l.qty_expected - EPS) return "short";
  if (l.qty_expected !== null && l.qty_received > l.qty_expected + EPS) return "over";
  return "ok";
}

/** A line needs a reason when it is short, over, rejected or not in good condition (the matrix control). */
export const lineNeedsReason = (l: Parameters<typeof lineState>[0]): boolean => lineState(l) !== "ok";

export function cleanReceiptLine(raw: unknown, index: number): Cleaned<ReceiptLineInput> {
  const where = `Line ${index + 1}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${where} is not valid` };
  const r = raw as Record<string, unknown>;
  const description = text(r.description, 300);
  if (!description) return { ok: false, error: `${where}: say what it is` };
  const received = num(r.qty_received);
  const expected = r.qty_expected === null || r.qty_expected === undefined || r.qty_expected === "" ? null : num(r.qty_expected);
  if (received === null || received < 0 || received > SITE_LIMITS.maxQty) return { ok: false, error: `${where}: enter how many arrived` };
  if (r.qty_expected !== null && r.qty_expected !== undefined && r.qty_expected !== "" && (expected === null || expected < 0 || expected > SITE_LIMITS.maxQty)) return { ok: false, error: `${where}: the expected quantity is not valid` };
  const rejectedGiven = r.qty_rejected === undefined || r.qty_rejected === null || r.qty_rejected === "" ? 0 : num(r.qty_rejected);
  if (rejectedGiven === null || rejectedGiven < 0) return { ok: false, error: `${where}: the rejected quantity is not valid` };
  const acceptedGiven = r.qty_accepted === undefined || r.qty_accepted === null || r.qty_accepted === "" ? received - rejectedGiven : num(r.qty_accepted);
  if (acceptedGiven === null || acceptedGiven < 0) return { ok: false, error: `${where}: the accepted quantity is not valid` };
  if (Math.abs(acceptedGiven + rejectedGiven - received) > EPS) return { ok: false, error: `${where}: accepted plus rejected must equal what arrived` };
  const condition = typeof r.condition === "string" && (CONDITIONS as readonly string[]).includes(r.condition) ? (r.condition as Condition) : "ok";
  const reason = typeof r.reason_code === "string" && r.reason_code ? r.reason_code : null;
  if (reason && !isReasonCode(reason)) return { ok: false, error: `${where}: choose a reason from the list` };
  const line: ReceiptLineInput = {
    line_key: isUuid(r.line_key) ? r.line_key : null,
    element_code: text(r.element_code, 80),
    building: text(r.building, 80),
    description,
    uom: text(r.uom, 30),
    qty_expected: expected === null ? null : q(expected),
    qty_received: q(received), qty_accepted: q(acceptedGiven), qty_rejected: q(rejectedGiven),
    condition, reason_code: reason, note: text(r.note, 500),
  };
  if (lineNeedsReason(line) && !line.reason_code) return { ok: false, error: `${where}: choose why it is ${lineState(line) === "over" ? "more than expected" : lineState(line)}` };
  if (line.reason_code === "other" && !line.note) return { ok: false, error: `${where}: say what happened (the reason is Other)` };
  return { ok: true, value: line };
}

/** A receipt as the phone sent it. The project, package and line keys are only SHAPE-checked here; the route verifies them against the workspace. */
export function cleanReceiptInput(body: Record<string, unknown>, opts: { now: Date }): Cleaned<ReceiptInput> {
  if (!isUuid(body.client_id)) return { ok: false, error: "client_id must be a uuid" };
  if (!isUuid(body.project_id)) return { ok: false, error: "Choose the project" };
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) return { ok: false, error: "Add at least one item" };
  if (rawLines.length > SITE_LIMITS.maxLines) return { ok: false, error: `A receipt holds at most ${SITE_LIMITS.maxLines} items. Split it in two` };
  const lines: ReceiptLineInput[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const c = cleanReceiptLine(rawLines[i], i);
    if (!c.ok) return c;
    lines.push(c.value);
  }
  const source = typeof body.source_type === "string" && (RECEIPT_SOURCES as readonly string[]).includes(body.source_type) ? (body.source_type as ReceiptSource) : "manual";
  // The time the delivery was counted: kept as captured (a phone with no signal stamps it at capture), but never in the future and never over a week old.
  let receivedAt = opts.now.toISOString();
  if (typeof body.received_at === "string") {
    const t = new Date(body.received_at).getTime();
    if (!Number.isNaN(t)) {
      if (t > opts.now.getTime() + 5 * 60_000) return { ok: false, error: "The time of the delivery is in the future" };
      if (t < opts.now.getTime() - 8 * 86_400_000) return { ok: false, error: "The delivery was counted more than a week ago. Ask the project manager" };
      receivedAt = new Date(t).toISOString();
    }
  }
  return {
    ok: true,
    value: {
      client_id: body.client_id, project_id: body.project_id,
      package_id: isUuid(body.package_id) ? body.package_id : null,
      delivery_note_ref: text(body.delivery_note_ref, 100),
      source_type: source, source_id: isUuid(body.source_id) ? body.source_id : null,
      received_at: receivedAt, handed_by: text(body.handed_by, 200), vehicle: text(body.vehicle, 100), note: text(body.note, 1000), lines,
    },
  };
}

/** The receipt's outcome follows from its lines: nothing accepted is Rejected, any gap is Partial, otherwise Complete. */
export function receiptOutcome(lines: readonly Pick<ReceiptLineInput, "qty_expected" | "qty_received" | "qty_accepted" | "qty_rejected" | "condition">[]): ReceiptOutcome {
  if (lines.length > 0 && lines.every((l) => l.qty_accepted <= EPS)) return "rejected";
  return lines.some((l) => lineState(l) !== "ok") ? "partial" : "complete";
}

export type ReceiptSummary = { lines: number; accepted: number; rejected: number; short: number; over: number; damaged: number };
/** The counts on the confirm step and the notes: pieces accepted, pieces rejected, pieces short. */
export function summarise(lines: readonly ReceiptLineInput[]): ReceiptSummary {
  let accepted = 0, rejected = 0, short = 0, over = 0, damaged = 0;
  for (const l of lines) {
    accepted += l.qty_accepted; rejected += l.qty_rejected;
    if (l.qty_expected !== null && l.qty_received < l.qty_expected) short += l.qty_expected - l.qty_received;
    if (l.qty_expected !== null && l.qty_received > l.qty_expected) over += l.qty_received - l.qty_expected;
    if (l.condition !== "ok") damaged += 1;
  }
  return { lines: lines.length, accepted: q(accepted), rejected: q(rejected), short: q(short), over: q(over), damaged };
}

/** Does anything on the receipt need the project manager's and logistics' attention? */
export const hasDiscrepancy = (lines: readonly ReceiptLineInput[]): boolean => lines.some((l) => lineState(l) !== "ok");

/** One plain line per problem, for the notification and the PDF: "Beam B2-003: short 1 (Not delivered)". */
export function discrepancyLines(lines: readonly ReceiptLineInput[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const s = lineState(l);
    if (s === "ok") continue;
    const name = (l.element_code ? `${l.element_code} ` : "") + l.description;
    const what = s === "short" ? `short ${q((l.qty_expected ?? 0) - l.qty_received)}` : s === "over" ? `${q(l.qty_received - (l.qty_expected ?? 0))} more than expected` : s === "rejected" ? `${l.qty_rejected} rejected` : `condition ${l.condition.replace("_", " ")}`;
    out.push(`${name}: ${what}${l.reason_code ? ` (${reasonLabel(l.reason_code)})` : ""}`);
  }
  return out;
}

// ── Against what was expected, and what it is worth ────────────────────────────────────────────────────────────────

/**
 * Quantity accepted on site per budget line, from the confirmed receipts only (a cancelled receipt counts for nothing). The key is the
 * line key; a line with no key is not attributable and is left out.
 */
export function acceptedByLine(receipts: readonly { status: string; lines: readonly { line_key: string | null; qty_accepted: number }[] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of receipts) {
    if (r.status !== "confirmed") continue;
    for (const l of r.lines) if (l.line_key) out.set(l.line_key, q((out.get(l.line_key) ?? 0) + Number(l.qty_accepted)));
  }
  return out;
}

export type PackageReceived = { package_id: string; committed: number; received_value: number; still_to_receive: number };
/**
 * Per buy-out package: what was awarded (committed), the value received (accepted quantity x the awarded rate of each line) and what is still to
 * receive. A value is never above the committed amount in the sum of its own lines' rates; over-receipt shows as a negative "still to receive".
 */
export function receivedValueByPackage(
  packages: readonly { package_id: string; committed: number; lines: readonly { line_key: string; qty: number; unit_cost: number }[] }[],
  accepted: ReadonlyMap<string, number>,
): PackageReceived[] {
  return packages.map((p) => {
    const value = p.lines.reduce((s, l) => s + (accepted.get(l.line_key) ?? 0) * l.unit_cost, 0);
    return { package_id: p.package_id, committed: round2(p.committed), received_value: round2(value), still_to_receive: round2(p.committed - value) };
  });
}

/** What is left to receive on a delivery note after earlier trucks: expected less the accepted-or-rejected received so far, never below zero. */
export function balanceAfter(expected: number | null, receivedBefore: number): number | null {
  return expected === null ? null : Math.max(0, q(expected - receivedBefore));
}
