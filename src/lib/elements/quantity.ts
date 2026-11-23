// Client quantity and model quantity (docs/design/pcbs-buildings-elements.md section 2.3), pure.
//
// `client_qty` is the contracted number: copied from the tender's file quantity when the project is made, then frozen; only a client variation
// changes the contract. `model_qty` is what the model or the drawings say. The budget's `qty` stays the one every surface reads, and one rule
// decides it: the budget uses the model quantity once one has been accepted into the line, else the client quantity.

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export type QtyBand = "none" | "within" | "over" | "red";

/**
 * The contracted quantity of a line. A line made from a tender carries it in `client_qty`; a line saved before the column existed, or one the
 * client never priced (no client rate), has none to speak of: the budget quantity stands in while the line is a contract line.
 */
export function clientQtyOf(l: { client_qty?: number | null; qty: number; client_rate?: number | null }): number | null {
  if (l.client_qty !== null && l.client_qty !== undefined) return Number(l.client_qty);
  return l.client_rate !== null && l.client_rate !== undefined ? Number(l.qty) : null;
}

export type BudgetUses = "client" | "model";

/** "Budget uses" chip: Model once a model quantity has been accepted into the line (the budget quantity equals it and the client's differs). */
export function budgetUses(l: { qty: number; client_qty?: number | null; model_qty?: number | null; client_rate?: number | null }): BudgetUses {
  if (l.model_qty === null || l.model_qty === undefined) return "client";
  const client = clientQtyOf(l);
  if (client !== null && Math.abs(client - Number(l.model_qty)) < 0.0005) return "client";
  return Math.abs(Number(l.qty) - Number(l.model_qty)) < 0.0005 ? "model" : "client";
}

export type Variance = { qty: number; pct: number | null; money: number };

/** Model minus client, as a quantity, as a percent of the client's, and as money at the client's rate (what the contract would carry if remeasured). */
export function varianceOf(client: number, model: number, clientRate: number): Variance {
  const qty = round3(model - client);
  return { qty, pct: client > 0 ? round2(((model - client) / client) * 100) : null, money: round2(qty * clientRate) };
}

/**
 * The band of a variance: within the tolerance is teal, over it amber, over twice it red. No percent (no client quantity) is no band. The
 * tolerance is one workspace number (default 5).
 */
export function toleranceBand(pct: number | null, tolerancePct: number): QtyBand {
  if (pct === null || !Number.isFinite(pct)) return "none";
  const a = Math.abs(pct);
  if (a <= tolerancePct) return "within";
  return a <= tolerancePct * 2 ? "over" : "red";
}

export type Repriced = { qty: number; amount: number; unit_cost: number };

/**
 * What a line becomes when its budget quantity changes to `newQty`. Allocation by BOQ line: the cost is quantity times unit cost, so the
 * amount follows. Allocation by WBS item: the cost typed on the item is untouched, so the amount stays and the unit cost follows. The contract
 * side (client rate and amount) is never touched: the contracted quantity bills.
 */
export function repriceForQty(l: { qty: number; unit_cost: number; amount: number; allocated: boolean }, newQty: number, basis: "line" | "package"): Repriced {
  const qty = round3(newQty);
  if (!l.allocated) return { qty, amount: 0, unit_cost: 0 };
  if (basis === "package") return { qty, amount: round2(l.amount), unit_cost: qty > 0 ? round4(l.amount / qty) : l.unit_cost };
  return { qty, amount: round2(qty * l.unit_cost), unit_cost: l.unit_cost };
}

/** The cost-only category lines under an element, which a quantity change does not rescale by itself (a guess). Optional ratio for the button. */
export function scaleByRatio(amount: number, unitCost: number, qty: number, ratio: number): Repriced {
  const q = round3(qty * ratio);
  return { qty: q, amount: round2(amount * ratio), unit_cost: unitCost };
}

/** A typed quantity: a number of 0 or more up to the limit, to three places; null when it is not that. */
export function cleanQty(v: unknown, max = 999_999_999): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? round3(n) : null;
}
