// Check with ERP (SO3, docs/design/sales-order.md): the pure half. Three read-only checks of an order against the ERP's own
// records -- credit, price, stock -- each turned into Passed / Warning / Failed / Not run with a one-line reason. The reading is
// src/lib/connectors/d365/checks.ts; storing is erpChecksServer.ts. Nothing here touches a database or the ERP, and nothing
// here knows a Dataverse field name: the reads hand over plain figures.
//
// Rules every check follows:
//   - a customer or product that is not linked to the ERP is a Warning ("not in the ERP yet"), never a crash;
//   - a figure the ERP did not return is a Warning for that line, not a failure of the whole check;
//   - an ERP that could not be asked at all is "not_run" with the reason, so the person knows nothing was compared;
//   - a free-text line (no catalogue product) has nothing to compare and is skipped.

/** The hand-applied database update that creates sales_order_checks and sales_order_transfers. */
export const ORDER_CHECKS_BUNDLE = "scripts/run-bundle-28-sales-order-checks-2026-10-24.sql";

export const CHECK_KINDS = ["credit", "price", "stock"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHECK_STATUSES = ["passed", "warning", "failed", "not_run"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_LABEL: Record<CheckKind, string> = { credit: "Credit", price: "Price", stock: "Stock" };
export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = { passed: "Passed", warning: "Warning", failed: "Failed", not_run: "Not run" };

/** A figure read from the ERP, or why it could not be read. */
export type ErpRead<T> = { ok: true; value: T } | { ok: false; reason: string };

export type CheckOutcome = { kind: CheckKind; status: CheckStatus; message: string; detail: Record<string, unknown> | null };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const money = (n: number, currency: string): string => `${currency} ${round2(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// ── credit ────────────────────────────────────────────────────────────────────

/** What the ERP holds about the customer's credit. A field the ERP did not return is `undefined`; one it holds empty is `null`. */
export type CreditFacts = {
  creditOnHold: boolean | null | undefined;
  creditLimit: number | null | undefined;
  /** Total of the customer's open (active or submitted) orders in the ERP. */
  openOrdersTotal: number | null;
  /** The list of open orders was longer than the read allows, so the total is "at least". */
  openOrdersCapped: boolean;
};

/** Above this share of the limit the result is a Warning even though the limit is not exceeded. */
export const CREDIT_WARN_SHARE = 0.9;

export function compareCredit(a: { customerLinked: boolean; read: ErpRead<CreditFacts> | null; orderTotal: number; currency: string }): CheckOutcome {
  const out = (status: CheckStatus, message: string, detail: Record<string, unknown> | null = null): CheckOutcome => ({ kind: "credit", status, message, detail });
  if (!a.customerLinked) return out("warning", "This customer is not in the ERP yet, so credit could not be checked.");
  if (!a.read) return out("not_run", "Credit was not checked.");
  if (!a.read.ok) return out("not_run", `Credit could not be checked: ${a.read.reason}`);
  const f = a.read.value;

  if (f.creditOnHold === true) return out("failed", "The customer is on credit hold in the ERP.", { credit_on_hold: true });

  const noFields = f.creditOnHold === undefined && f.creditLimit === undefined;
  if (noFields) return out("warning", "The ERP returned no credit information for this customer.");

  const limit = typeof f.creditLimit === "number" && Number.isFinite(f.creditLimit) && f.creditLimit > 0 ? f.creditLimit : null;
  if (limit === null) return out("passed", "No credit limit is set for this customer in the ERP, and it is not on hold.", { credit_on_hold: false, credit_limit: null });

  const open = f.openOrdersTotal ?? 0;
  const exposure = round2(open + a.orderTotal);
  const detail = { credit_on_hold: false, credit_limit: limit, open_orders_total: round2(open), order_total: round2(a.orderTotal), exposure, capped: f.openOrdersCapped };
  const atLeast = f.openOrdersCapped ? "at least " : "";
  if (exposure > limit) {
    return out("failed", `With this order the customer owes ${atLeast}${money(exposure, a.currency)}, over the credit limit of ${money(limit, a.currency)}.`, detail);
  }
  if (exposure > limit * CREDIT_WARN_SHARE) {
    return out("warning", `With this order the customer owes ${atLeast}${money(exposure, a.currency)}, close to the credit limit of ${money(limit, a.currency)}.`, detail);
  }
  return out("passed", `Within the credit limit: ${atLeast}${money(exposure, a.currency)} of ${money(limit, a.currency)}.`, detail);
}

// ── price ─────────────────────────────────────────────────────────────────────

export type PriceFacts = {
  /** The price in the customer's ERP price list; else the product's own list price. Null when the ERP holds none. */
  price: number | null;
  source: "price_list" | "product";
};

export type PriceLineInput = {
  lineId: string;
  lineNo: number;
  description: string;
  unitPrice: number;
  /** The line has a catalogue product; a free-text line has none and is skipped. */
  hasProduct: boolean;
  /** The product has an ERP counterpart (a connector link). */
  productLinked: boolean;
  erp: ErpRead<PriceFacts> | null;
};

/** A price within this share of the ERP's (or one cent) counts as the same. */
export const PRICE_TOLERANCE = 0.005;

export function comparePrice(a: { lines: PriceLineInput[]; currency: string }): CheckOutcome {
  const out = (status: CheckStatus, message: string, detail: Record<string, unknown> | null = null): CheckOutcome => ({ kind: "price", status, message, detail });
  if (a.lines.length === 0) return out("not_run", "The order has no lines to check.");
  const product = a.lines.filter((l) => l.hasProduct);
  if (product.length === 0) return out("not_run", "No line is a catalogue product, so there is no ERP price to compare with.");

  let firstReason: string | undefined;
  const rows = product.map((l) => {
    const base = { line_id: l.lineId, line_no: l.lineNo, description: l.description, bpm_price: round2(l.unitPrice) };
    if (!l.productLinked) return { ...base, state: "unlinked" as const, erp_price: null };
    if (!l.erp) return { ...base, state: "unreadable" as const, erp_price: null };
    if (!l.erp.ok) { firstReason ??= l.erp.reason; return { ...base, state: "unreadable" as const, erp_price: null }; }
    const p = l.erp.value.price;
    if (p === null || !Number.isFinite(p)) return { ...base, state: "no_price" as const, erp_price: null };
    const differs = Math.abs(l.unitPrice - p) > Math.max(0.01, Math.abs(p) * PRICE_TOLERANCE);
    return { ...base, state: differs ? ("differs" as const) : ("same" as const), erp_price: round2(p), source: l.erp.value.source };
  });
  const count = (s: string) => rows.filter((r) => r.state === s).length;
  const detail = { lines: rows };

  if (count("unreadable") === rows.length) {
    const reason = firstReason;
    return out("not_run", `Prices could not be read from the ERP${reason ? `: ${reason}` : "."}`, detail);
  }
  const issues: string[] = [];
  if (count("differs") > 0) issues.push(`${plural(count("differs"), "line is", "lines are")} priced differently from the ERP`);
  if (count("unlinked") > 0) issues.push(`${plural(count("unlinked"), "product is", "products are")} not in the ERP yet`);
  if (count("no_price") > 0) issues.push(`${plural(count("no_price"), "product has", "products have")} no ERP price`);
  if (count("unreadable") > 0) issues.push(`${plural(count("unreadable"), "price", "prices")} could not be read`);
  if (issues.length > 0) {
    const first = rows.find((r) => r.state === "differs");
    const example = first ? ` (${first.description}: ${money(first.bpm_price, a.currency)} here, ${money(first.erp_price as number, a.currency)} in the ERP)` : "";
    return out("warning", `${issues.join("; ")}${example}.`, detail);
  }
  return out("passed", `${plural(count("same"), "line matches", "lines match")} the ERP price list.`, detail);
}

// ── stock ─────────────────────────────────────────────────────────────────────

export type StockLineInput = {
  lineId: string;
  lineNo: number;
  description: string;
  qty: number;
  uom: string | null;
  hasProduct: boolean;
  productLinked: boolean;
  /** Quantity on hand in the ERP; null when the ERP holds none for the product. */
  erp: ErpRead<{ onHand: number | null }> | null;
};

/** `figure` names what the ERP's number is: "on hand" for a stock record, "confirmed" for an availability check that confirms a quantity. */
export function compareStock(a: { lines: StockLineInput[]; figure?: string }): CheckOutcome {
  const out = (status: CheckStatus, message: string, detail: Record<string, unknown> | null = null): CheckOutcome => ({ kind: "stock", status, message, detail });
  if (a.lines.length === 0) return out("not_run", "The order has no lines to check.");
  const product = a.lines.filter((l) => l.hasProduct);
  if (product.length === 0) return out("not_run", "No line is a catalogue product, so there is no ERP stock to compare with.");

  let firstReason: string | undefined;
  const rows = product.map((l) => {
    const base = { line_id: l.lineId, line_no: l.lineNo, description: l.description, qty: l.qty, uom: l.uom };
    if (!l.productLinked) return { ...base, state: "unlinked" as const, on_hand: null };
    if (!l.erp) return { ...base, state: "unreadable" as const, on_hand: null };
    if (!l.erp.ok) { firstReason ??= l.erp.reason; return { ...base, state: "unreadable" as const, on_hand: null }; }
    const onHand = l.erp.value.onHand;
    if (onHand === null || !Number.isFinite(onHand)) return { ...base, state: "unknown" as const, on_hand: null };
    return { ...base, state: l.qty > onHand ? ("short" as const) : ("ok" as const), on_hand: onHand };
  });
  const count = (s: string) => rows.filter((r) => r.state === s).length;
  const detail = { lines: rows };

  if (count("unreadable") === rows.length) {
    const reason = firstReason;
    return out("not_run", `Stock could not be read from the ERP${reason ? `: ${reason}` : "."}`, detail);
  }
  const short = rows.filter((r) => r.state === "short");
  if (short.length > 0) {
    const s = short[0];
    const e = `${s.description}: ${s.qty} asked, ${s.on_hand} ${a.figure ?? "on hand"}`;
    return out("failed", `${plural(short.length, "line is", "lines are")} short on stock in the ERP (${e}).`, detail);
  }
  const issues: string[] = [];
  if (count("unlinked") > 0) issues.push(`${plural(count("unlinked"), "product is", "products are")} not in the ERP yet`);
  if (count("unknown") > 0) issues.push(`${plural(count("unknown"), "product has", "products have")} no stock figure in the ERP`);
  if (count("unreadable") > 0) issues.push(`${plural(count("unreadable"), "stock figure", "stock figures")} could not be read`);
  if (issues.length > 0) return out("warning", `${issues.join("; ")}.`, detail);
  return out("passed", `${plural(count("ok"), "line is", "lines are")} in stock in the ERP.`, detail);
}

// ── out of date ───────────────────────────────────────────────────────────────

export type HashLine = { line_no: number; product_id: string | null; qty: number; unit_price: number; discount_pct: number; tax_pct: number };

// Two FNV-1a passes with different seeds: 64 bits of hex is plenty for "did anything the checks read change", and it needs no
// crypto module, so the same function can run in a test or in a screen.
function fnv(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Fingerprint of everything the three checks read: the customer, the currency and shipping, and each line's product,
 * quantity, price, discount and tax. A result stored with a different fingerprint is out of date. Descriptions, printed text,
 * notes and dates are not in it: editing those never invalidates a check.
 */
export function quantityHash(order: { account_id: string | null; currency: string | null; shipping_amount?: number | string | null }, lines: HashLine[]): string {
  const canon = JSON.stringify([
    order.account_id ?? "", order.currency ?? "", Number(order.shipping_amount ?? 0),
    [...lines].sort((x, y) => x.line_no - y.line_no).map((l) => [l.product_id ?? "", Number(l.qty), Number(l.unit_price), Number(l.discount_pct), Number(l.tax_pct)]),
  ]);
  return fnv(canon, 0x811c9dc5) + fnv(canon, 0x1b873593);
}

/** A result is out of date when the order's fingerprint is no longer the one it was run on. A result with no fingerprint (a sample) is never out of date. */
export function isStale(check: { quantity_hash: string | null }, currentHash: string): boolean {
  return check.quantity_hash !== null && check.quantity_hash !== currentHash;
}

// ── what the screens and the API carry ────────────────────────────────────────

export const CHECK_COLUMNS = "kind, status, message, detail, checked_at, quantity_hash";

export type CheckRow = { kind: string; status: string; message: string | null; detail: unknown; checked_at: string; quantity_hash: string | null };

export type ErpCheckView = {
  kind: CheckKind;
  status: CheckStatus;
  message: string | null;
  detail: Record<string, unknown> | null;
  checked_at: string;
  /** The lines or the customer changed since this ran: say "Out of date, check again". */
  stale: boolean;
};

const isKind = (v: unknown): v is CheckKind => (CHECK_KINDS as readonly unknown[]).includes(v);
const isStatus = (v: unknown): v is CheckStatus => (CHECK_STATUSES as readonly unknown[]).includes(v);

export function shapeCheck(r: CheckRow, currentHash: string): ErpCheckView | null {
  if (!isKind(r.kind) || !isStatus(r.status)) return null;
  const detail = r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? (r.detail as Record<string, unknown>) : null;
  return { kind: r.kind, status: r.status, message: r.message, detail, checked_at: r.checked_at, stale: isStale(r, currentHash) };
}

/** The three checks in their fixed order, `null` for one that was never run. */
export function checksByKind(checks: ErpCheckView[]): Record<CheckKind, ErpCheckView | null> {
  const by: Record<CheckKind, ErpCheckView | null> = { credit: null, price: null, stock: null };
  for (const c of checks) by[c.kind] = c;
  return by;
}

/** Overview shows a banner only for a check that failed and is still current. A pass stays quiet; an out-of-date result says nothing. */
export function failedChecks(checks: Pick<ErpCheckView, "kind" | "status" | "stale">[]): CheckKind[] {
  return CHECK_KINDS.filter((k) => checks.some((c) => c.kind === k && c.status === "failed" && !c.stale));
}

export function failedChecksText(checks: Pick<ErpCheckView, "kind" | "status" | "stale">[]): string | null {
  const failed = failedChecks(checks);
  if (failed.length === 0) return null;
  const words = failed.map((k) => CHECK_LABEL[k].toLowerCase());
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `The ERP ${words.length === 1 ? "check" : "checks"} for ${list} failed.`;
}

/** The word a result row shows: the status, or "Out of date" when the lines changed since it ran. */
export function checkWord(c: Pick<ErpCheckView, "status" | "stale"> | null): string {
  if (!c) return "Not checked";
  return c.stale ? "Out of date" : CHECK_STATUS_LABEL[c.status];
}

/**
 * What must be read and confirmed before an order goes to the ERP: every check that is not a current pass. Warns, never
 * blocks (owner, SO3). `items` are the sentences the confirm step lists; `needed` is true when there is at least one.
 */
export function confirmNeeded(checks: ErpCheckView[]): { needed: boolean; items: string[] } {
  const by = checksByKind(checks);
  const items: string[] = [];
  for (const k of CHECK_KINDS) {
    const c = by[k];
    if (!c) items.push(`${CHECK_LABEL[k]}: not checked yet`);
    else if (c.stale) items.push(`${CHECK_LABEL[k]}: out of date, check again`);
    else if (c.status !== "passed") items.push(`${CHECK_LABEL[k]}: ${CHECK_STATUS_LABEL[c.status].toLowerCase()}${c.message ? `, ${c.message.replace(/\.$/, "")}` : ""}`);
  }
  return { needed: items.length > 0, items };
}

// ── may this order go to the ERP ──────────────────────────────────────────────

/**
 * Why an order cannot be checked or sent yet, in words for the disabled button; null when it can. One rule for the screen, the
 * routes and the assistant. A draft or a confirmed order made here, with a customer the ERP knows and at least one line.
 */
export function sendReadiness(a: {
  origin: string; status: string; erpLinked: boolean; hasAccount: boolean; customerLinked: boolean; lineCount: number; allQuantitiesPositive: boolean;
  /** Check with ERP asks less than Send: an unlinked customer is a Warning on the check, not a reason to refuse it. */
  forCheck?: boolean;
}): string | null {
  if (a.origin !== "bpmsquare") return "This order comes from the ERP, so there is nothing to send.";
  if (a.status === "cancelled") return "A cancelled order can't be sent.";
  if (a.erpLinked) return "This order is already in the ERP.";
  if (!a.hasAccount) return "Choose a customer first.";
  if (a.lineCount === 0) return "Add at least one line first.";
  if (a.forCheck) return null;
  if (!a.customerLinked) return "This customer is not in the ERP yet. Sync customers from the ERP first.";
  if (!a.allQuantitiesPositive) return "Every line needs a quantity above zero.";
  return null;
}

// ── transfers ─────────────────────────────────────────────────────────────────

export const TRANSFER_COLUMNS = "id, attempted_at, user_id, result, erp_number, step, message";

export const TRANSFER_RESULTS = ["sent", "failed", "already_sent"] as const;
export type TransferResult = (typeof TRANSFER_RESULTS)[number];

export type TransferRow = { id: string; attempted_at: string; user_id: string | null; result: string; erp_number: string | null; step: string | null; message: string | null };

export type ErpTransferView = {
  id: string;
  attempted_at: string;
  /** The person's name; null for a system action or a person who is no longer in the workspace. */
  by: string | null;
  result: TransferResult;
  erp_number: string | null;
  step: string | null;
  message: string | null;
};

export function shapeTransfer(r: TransferRow, names: Map<string, string>): ErpTransferView | null {
  if (!(TRANSFER_RESULTS as readonly string[]).includes(r.result)) return null;
  return {
    id: r.id, attempted_at: r.attempted_at, by: r.user_id ? names.get(r.user_id) ?? null : null,
    result: r.result as TransferResult, erp_number: r.erp_number, step: r.step, message: r.message,
  };
}

export const TRANSFER_WORD: Record<TransferResult, string> = { sent: "Sent", failed: "Failed", already_sent: "Already sent" };
