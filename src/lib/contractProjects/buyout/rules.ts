// Contract buy-out (docs/design/contract-buyout.md): the pure rules and the shapes the routes answer with. PURE: no server imports, so the
// routes, the screens and the tests share one set of rules. Money here is the internal COST side (what we pay suppliers): nothing in this
// folder is ever printed on a customer document or exposed through the v1 API, MCP, Data Workbench or Talk to data.

import { responseValidity, type CompareResponse } from "@/lib/rfq/comparison";
import { landedUnit } from "@/lib/rfq/rules";
import { RFQ_LIMITS } from "@/lib/rfq/types";

export const PACKAGE_KINDS = ["supplier", "subcontract"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const PACKAGE_KIND_LABEL: Record<PackageKind, string> = { supplier: "Supplier", subcontract: "Subcontract" };

export const PACKAGE_STATUSES = ["draft", "out", "ready", "awarded", "handed_over"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  draft: "Not sent", out: "Out for quotes", ready: "Ready to award", awarded: "Awarded", handed_over: "Handed over",
};

export const PACKAGE_LIMITS = {
  maxPackages: 500,
  /** An RFQ round carries every line of the package, and an RFQ holds at most this many lines. */
  maxLines: RFQ_LIMITS.maxLines,
  maxSuppliers: RFQ_LIMITS.maxSuppliers,
  maxRounds: 25,
  name: 200,
  note: 1000,
  reason: 1000,
  erpRef: 100,
} as const;

export const BUYOUT_BUNDLE = "scripts/run-bundle-42-contract-buyout-2026-10-28.sql";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export { round2 as roundMoney };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

// ── Shapes the routes answer with (the API contract, section 5) ────────────────────────────────────────────────────────

export type HandoverState = "not_ready" | "ready" | "sent";

export type PackageRow = {
  id: string;
  ref: string | null;
  name: string;
  kind: PackageKind;
  /** The status a person reads: draft / out / ready are worked out from the rounds, awarded and handed_over are stored. */
  status: PackageStatus;
  line_count: number;
  /** What the package's budget lines add up to in the approved budget (internal cost). */
  budget: number;
  /** What the same lines cost in the baseline budget the winning bid started from (revision 0). */
  bid_cost: number;
  /** The lowest valid complete quote of the CURRENT round; null when there is none. */
  best_quote: number | null;
  /** The awarded total; null until the package is awarded. */
  committed: number | null;
  /** Budget less the committed amount (or, before the award, less the best quote): positive is under budget, negative is over. Null with neither. */
  against_budget: number | null;
  /** 1-based number of the current round, null while no round was sent. */
  current_round: number | null;
  /** How many rounds were sent. */
  rounds: number;
  handover: { state: HandoverState; sent_at: string | null };
  note: string | null;
  awarded_supplier_id: string | null;
  awarded_supplier_name: string | null;
};

export type BudgetLineRow = {
  /** The line's id in the approved budget revision. */
  id: string;
  /** Stable across revisions: what a package keeps. */
  line_key: string;
  line_no: number;
  wbs: string | null;
  description: string;
  qty: number;
  unit: string | null;
  resource_code: string | null;
  cost_code: string | null;
  amount: number;
};

export type BuyoutTiles = {
  /** The budget of the lines that are in packages. */
  budget: number;
  committed: number;
  /** Over the packages that have a committed amount or a best quote: budget less that figure. Positive is a saving. */
  best_vs_budget: number;
  /** Packages with a valid quote waiting for an award. */
  needs_decision: number;
  packages: number;
  /** The whole approved budget, and the part not in any package. */
  project_budget: number;
  unassigned_budget: number;
};

export type BuyoutSummary = {
  /** The approved budget revision packages are made from; null while the baseline is not approved (nothing can be packaged yet). */
  baseline: { revision_id: string; rev_no: number } | null;
  group: { id: string; name: string } | null;
  /** True when the project's client has an approved supplier list that limits the pickers. */
  restricted: boolean;
  currency: string | null;
  tiles: BuyoutTiles;
  packages: PackageRow[];
  unassigned_lines: BudgetLineRow[];
  /** For the Budget tab's Committed column: the awarded amount of each budget line (by line_key) of an awarded or handed-over package. */
  committed_by_line: Record<string, number>;
  can_edit: boolean;
  /** The RFQ module is on and the caller may edit RFQs: rounds can be sent. */
  can_send_rounds: boolean;
};

export type RoundQuote = {
  supplier_id: string;
  supplier_name: string;
  /** The package total at this supplier's prices; null while the supplier has not quoted every line. */
  total: number | null;
  lines_quoted: number;
  lines_total: number;
  lead_days: number | null;
  /** Every answer is still usable (not expired, not stale) and the quote is complete. */
  valid: boolean;
  /** The lowest total among the valid complete quotes of this round (a tie marks both). */
  lowest_valid: boolean;
  replied_at: string | null;
  status: string;
  /** This quote is the one the package was awarded on. */
  awarded: boolean;
};

export type RoundView = {
  rfq_id: string;
  ref: string | null;
  /** 1-based, by created order. */
  round: number;
  created_at: string;
  created_by: string | null;
  status: string;
  respond_by: string | null;
  is_current: boolean;
  suppliers_total: number;
  suppliers_replied: number;
  quotes: RoundQuote[];
};

export type PackageLineView = {
  id: string;
  line_key: string;
  item_no: string | null;
  description: string;
  qty: number;
  uom: string | null;
  cost_code: string | null;
  /** The cost of this line in the baseline budget (the bid's cost). */
  cost_in_bid: number;
  /** The line in the approved budget now. */
  budget: number;
};

export type PackageDetail = {
  package: PackageRow & {
    currency: string | null;
    current_rfq_id: string | null;
    awarded_rfq_id: string | null;
    award_reason: string | null;
    awarded_by_name: string | null;
    awarded_at: string | null;
    erp_ref: string | null;
    created_at: string;
  };
  lines: PackageLineView[];
  rounds: RoundView[];
  budget_bars: { budget: number; bid_cost: number; best_quote: number | null; committed: number | null; max: number };
  handover: { state: HandoverState; sent_at: string | null; sent_by_name: string | null; erp_ref: string | null };
  can_edit: boolean;
  can_send_rounds: boolean;
  /** Lines can change only before the first round is sent and while the package is not awarded. */
  lines_locked: boolean;
};

// ── Input ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PackageInput = { name?: string; kind?: PackageKind; note?: string | null; budget_line_ids?: string[] };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePackage(body: unknown, mode: "create" | "update"): Parsed<PackageInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid body" };
  const o = body as Record<string, unknown>;
  const out: PackageInput = {};
  if (mode === "create" || "name" in o) {
    const name = text(o.name, PACKAGE_LIMITS.name);
    if (!name) return { ok: false, error: "Give the package a name" };
    out.name = name;
  }
  if (mode === "create" || "kind" in o) {
    const kind = o.kind === undefined || o.kind === null || o.kind === "" ? "supplier" : o.kind;
    if (!(PACKAGE_KINDS as readonly unknown[]).includes(kind)) return { ok: false, error: "Kind must be supplier or subcontract" };
    out.kind = kind as PackageKind;
  }
  if ("note" in o) {
    if (o.note !== null && typeof o.note !== "string") return { ok: false, error: "Note must be text" };
    out.note = text(o.note, PACKAGE_LIMITS.note);
  }
  if (mode === "create" || "budget_line_ids" in o) {
    const ids = o.budget_line_ids;
    if (!Array.isArray(ids)) return { ok: false, error: "Choose the budget lines for the package" };
    if (ids.some((x) => !isUuid(x))) return { ok: false, error: "A budget line id is not valid" };
    const unique = [...new Set((ids as string[]).map((x) => x.toLowerCase()))];
    if (unique.length !== ids.length) return { ok: false, error: "The same budget line is chosen twice" };
    if (mode === "create" && unique.length === 0) return { ok: false, error: "Choose at least one budget line" };
    if (unique.length > PACKAGE_LIMITS.maxLines) return { ok: false, error: `A package holds up to ${PACKAGE_LIMITS.maxLines} lines` };
    out.budget_line_ids = unique;
  }
  return { ok: true, value: out };
}

export type RoundInput = { supplier_ids: string[]; reply_by: string | null; note: string | null };

export function parseRound(body: unknown): Parsed<RoundInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid body" };
  const o = body as Record<string, unknown>;
  const ids = o.supplier_ids;
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Choose at least one supplier" };
  if (ids.some((x) => !isUuid(x))) return { ok: false, error: "A supplier id is not valid" };
  const unique = [...new Set((ids as string[]).map((x) => x.toLowerCase()))];
  if (unique.length > PACKAGE_LIMITS.maxSuppliers) return { ok: false, error: `At most ${PACKAGE_LIMITS.maxSuppliers} suppliers per round` };
  let reply_by: string | null = null;
  if (o.reply_by !== undefined && o.reply_by !== null && o.reply_by !== "") {
    if (typeof o.reply_by !== "string" || !DATE_RE.test(o.reply_by) || Number.isNaN(Date.parse(`${o.reply_by}T00:00:00Z`))) return { ok: false, error: "Reply-by must be a date (YYYY-MM-DD)" };
    reply_by = o.reply_by;
  }
  if (o.note !== undefined && o.note !== null && typeof o.note !== "string") return { ok: false, error: "Note must be text" };
  return { ok: true, value: { supplier_ids: unique, reply_by, note: text(o.note, 2000) } };
}

// ── The quotes of one round ────────────────────────────────────────────────────────────────────────────────────────────

export type RoundLineInput = { id: string; qty: number | null; status?: string };
export type RoundSupplierInput = { id: string; supplier_id: string; name: string; status: string; replied_at: string | null };
export type RoundResponseInput = CompareResponse & { rfq_supplier_id: string };

/** A line asked with no quantity is priced as 1 (the Costing tab's rule), so a total never silently drops a line. */
export const lineQty = (q: number | null | undefined): number => (q != null && Number.isFinite(Number(q)) && Number(q) > 0 ? Number(q) : 1);

const priceOf = (r: CompareResponse): number | null => {
  if (r.status === "no_quote") return null;
  const v = landedUnit(r);
  return v !== null && v > 0 ? v : null;
};

/**
 * What each supplier of one round quotes for the WHOLE package. A package is awarded to one supplier, so a supplier that has not priced
 * every live line has no total (it cannot be awarded) but still shows how many lines it quoted. `valid` needs every answer to be usable
 * (a validity date not passed, or newer than the stale limit); `lowest_valid` marks the cheapest valid complete total.
 */
export function roundQuotes(args: {
  lines: readonly RoundLineInput[];
  suppliers: readonly RoundSupplierInput[];
  responses: readonly RoundResponseInput[];
  today: string;
  staleDays: number;
  awarded?: { supplier_id: string } | null;
}): RoundQuote[] {
  const live = args.lines.filter((l) => l.status !== "cancelled");
  const qtyOf = new Map(live.map((l) => [l.id, lineQty(l.qty)]));
  const out: RoundQuote[] = [];
  for (const s of args.suppliers) {
    if (s.status === "cancelled") continue;
    const mine = args.responses.filter((r) => r.rfq_supplier_id === s.id && qtyOf.has(r.rfq_line_id));
    let quoted = 0, total = 0, lead: number | null = null, usable = true, repliedAt = s.replied_at;
    for (const l of live) {
      const r = mine.find((x) => x.rfq_line_id === l.id);
      const p = r ? priceOf(r) : null;
      if (!r || p === null) continue;
      quoted++;
      total += p * (qtyOf.get(l.id) ?? 1);
      if (r.lead_time_days != null && Number.isFinite(Number(r.lead_time_days))) lead = Math.max(lead ?? 0, Number(r.lead_time_days));
      if (responseValidity(r, args.today, args.staleDays) !== "ok") usable = false;
      if (!repliedAt || r.submitted_at > repliedAt) repliedAt = r.submitted_at;
    }
    const complete = live.length > 0 && quoted === live.length;
    out.push({
      supplier_id: s.supplier_id, supplier_name: s.name, total: complete ? round2(total) : null, lines_quoted: quoted, lines_total: live.length,
      lead_days: lead, valid: complete && usable, lowest_valid: false, replied_at: quoted > 0 ? repliedAt : s.replied_at, status: s.status,
      awarded: !!args.awarded && args.awarded.supplier_id === s.supplier_id,
    });
  }
  const best = lowestValidTotal(out);
  if (best !== null) for (const q of out) q.lowest_valid = q.valid && q.total !== null && Math.abs(q.total - best) < 0.005;
  return out;
}

/** The cheapest valid complete total of a round, or null. */
export function lowestValidTotal(quotes: readonly Pick<RoundQuote, "total" | "valid">[]): number | null {
  const t = quotes.filter((q) => q.valid && q.total !== null).map((q) => q.total as number);
  return t.length ? Math.min(...t) : null;
}

/** The cheapest complete total of a round whether or not it is still valid, or null. */
export function lowestAnyTotal(quotes: readonly Pick<RoundQuote, "total">[]): number | null {
  const t = quotes.filter((q) => q.total !== null).map((q) => q.total as number);
  return t.length ? Math.min(...t) : null;
}

// ── The award ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AwardDecision = {
  /** The chosen total is not the lowest valid price of the current round (or the chosen answer is itself out of date), so a reason is required. */
  needsReason: boolean;
  why: "higher" | "expired" | null;
  /** What the choice was held against. */
  lowestValid: number | null;
};

/**
 * The reason rule of the existing RFQ award, at package level (docs/design/contract-buyout.md section 3): a package award needs a reason when the
 * chosen total is dearer than the lowest valid total of the CURRENT round, or when the chosen answer is itself expired or stale while a valid one
 * exists. With no valid quote in the current round the baseline is the cheapest quote that exists there, and with none at all, the cheapest of the
 * round chosen from. Ties are not "not lowest".
 */
export function packageAwardDecision(args: {
  chosen: Pick<RoundQuote, "total" | "valid">; chosenRound: readonly Pick<RoundQuote, "total" | "valid">[]; currentRound: readonly Pick<RoundQuote, "total" | "valid">[];
}): AwardDecision {
  const total = args.chosen.total;
  if (total === null) return { needsReason: false, why: null, lowestValid: null };
  const validCurrent = lowestValidTotal(args.currentRound);
  const validChosenRound = lowestValidTotal(args.chosenRound);
  if (!args.chosen.valid && (validCurrent !== null || validChosenRound !== null)) {
    return { needsReason: true, why: "expired", lowestValid: validCurrent ?? validChosenRound };
  }
  const baseline = validCurrent ?? lowestAnyTotal(args.currentRound) ?? lowestAnyTotal(args.chosenRound) ?? total;
  const higher = total > baseline + 0.005;
  return { needsReason: higher, why: higher ? "higher" : null, lowestValid: validCurrent };
}

export type AwardProblem = { status: number; error: string; code?: string };

export function awardProblem(p: { status: PackageStatus; line_count: number }): AwardProblem | null {
  if (p.status === "handed_over") return { status: 409, error: "This package was handed over. It can no longer be changed here.", code: "handed_over" };
  if (p.status === "awarded") return { status: 409, error: "This package is already awarded. Un-award it first to award another supplier.", code: "already_awarded" };
  if (p.line_count === 0) return { status: 409, error: "This package has no lines.", code: "no_lines" };
  return null;
}

export function unawardProblem(p: { status: PackageStatus }): AwardProblem | null {
  if (p.status === "handed_over") return { status: 409, error: "The handover was marked as sent, so the award can no longer be undone.", code: "handed_over" };
  if (p.status !== "awarded") return { status: 409, error: "This package is not awarded.", code: "not_awarded" };
  return null;
}

/** The reason text of a package award or un-award: trimmed, capped, null under 3 characters. */
export function cleanPackageReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, PACKAGE_LIMITS.reason);
  return t.length >= 3 ? t : null;
}

/** The reason stored on each RFQ line award when the package-level rule needed none: the per-line rule still asks one of the existing award. */
export const PACKAGE_LINE_REASON = "Package award on the lowest package total";

// ── Status, tiles, handover ────────────────────────────────────────────────────────────────────────────────────────────

/** awarded and handed_over are stored; the rest follow the rounds: no round is "draft", a round with no usable quote is "out", one with a valid complete quote is "ready". */
export function effectiveStatus(p: { stored: PackageStatus; rounds: number; best_quote: number | null }): PackageStatus {
  if (p.stored === "awarded" || p.stored === "handed_over") return p.stored;
  if (p.rounds === 0) return "draft";
  return p.best_quote !== null ? "ready" : "out";
}

export function handoverState(p: { status: PackageStatus; handover_sent_at: string | null }): { state: HandoverState; sent_at: string | null } {
  if (p.handover_sent_at) return { state: "sent", sent_at: p.handover_sent_at };
  return { state: p.status === "awarded" ? "ready" : "not_ready", sent_at: null };
}

/** Budget less what we pay (or, before the award, what the best quote would cost). Positive is a saving. */
export function againstBudget(budget: number, committed: number | null, bestQuote: number | null): number | null {
  const paid = committed ?? bestQuote;
  return paid === null ? null : round2(budget - paid);
}

export function buyoutTiles(rows: readonly Pick<PackageRow, "status" | "budget" | "committed" | "best_quote">[], projectBudget: number): BuyoutTiles {
  let budget = 0, committed = 0, vs = 0, needs = 0;
  for (const r of rows) {
    budget += r.budget;
    if (r.committed !== null) committed += r.committed;
    const paid = r.committed ?? r.best_quote;
    if (paid !== null) vs += r.budget - paid;
    if (r.status === "ready") needs++;
  }
  return {
    budget: round2(budget), committed: round2(committed), best_vs_budget: round2(vs), needs_decision: needs, packages: rows.length,
    project_budget: round2(projectBudget), unassigned_budget: round2(projectBudget - budget),
  };
}

/** Warn, never block: the committed amount of a package is over its budget. */
export const overBudget = (budget: number, committed: number | null): boolean => committed !== null && committed > budget + 0.005;

/** The Excel handover can be made for an awarded (or already handed-over) package only. */
export const canDownloadHandover = (status: PackageStatus): boolean => status === "awarded" || status === "handed_over";

export function markSentProblem(p: { status: PackageStatus; handover_sent_at: string | null }): AwardProblem | null {
  if (p.handover_sent_at || p.status === "handed_over") return { status: 409, error: "The handover was already marked as sent.", code: "handed_over" };
  if (p.status !== "awarded") return { status: 409, error: "Award the package before handing it over.", code: "not_awarded" };
  return null;
}

/** A package can be deleted while it is a draft and no round was ever sent (rounds are kept for audit). */
export function deleteProblem(p: { status: PackageStatus; rounds: number }): AwardProblem | null {
  if (p.rounds > 0) return { status: 409, error: "A round was sent for this package, and rounds are kept for the record. It cannot be deleted.", code: "has_rounds" };
  if (p.status !== "draft") return { status: 409, error: "Only a package that was never sent can be deleted.", code: "not_draft" };
  return null;
}

/** Lines may change only before any round exists and while the package is not awarded. */
export function linesLocked(p: { status: PackageStatus; rounds: number }): boolean {
  return p.rounds > 0 || p.status === "awarded" || p.status === "handed_over";
}

export function roundProblem(p: { status: PackageStatus; line_count: number; rounds: number }): AwardProblem | null {
  if (p.status === "handed_over") return { status: 409, error: "This package was handed over.", code: "handed_over" };
  if (p.status === "awarded") return { status: 409, error: "This package is awarded. Un-award it before asking for new quotes.", code: "already_awarded" };
  if (p.line_count === 0) return { status: 409, error: "This package has no lines.", code: "no_lines" };
  if (p.rounds >= PACKAGE_LIMITS.maxRounds) return { status: 409, error: `A package holds up to ${PACKAGE_LIMITS.maxRounds} rounds.`, code: "too_many_rounds" };
  return null;
}

export function roundTitle(pkg: { ref: string | null; name: string }, round: number): string {
  return `${pkg.ref ? `${pkg.ref} ` : ""}${pkg.name} · round ${round}`.slice(0, 200);
}

export const roundOriginLabel = (project: { ref: string | null; name: string }, pkg: { ref: string | null }): string =>
  `Buy-out ${pkg.ref ?? "package"} · ${project.ref ?? project.name}`.slice(0, 200);
