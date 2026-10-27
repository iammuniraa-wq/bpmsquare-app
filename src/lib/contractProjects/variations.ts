// Variations of a contract project (docs/design/gcc-tender-deals.md section 23, migration 0231): a client change after the award, priced and
// approved. PURE: no I/O and no server imports, so the routes, the screen and the tests share one set of rules.
//
// Money. `amount` is the change in CONTRACT VALUE (what the client pays more or less, signed), `cost_amount` the change in our internal
// COST (signed). Approving adds `amount` to the project's contract value and, when the project has an approved baseline and no open
// revision, opens a budget revision for the cost. The contract value is therefore the REVISED value; the original is the revised value
// less the approved variations, and is never stored twice.

import type { DraftLine } from "./types";

export const VARIATION_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type VariationStatus = (typeof VARIATION_STATUSES)[number];
export const VARIATION_STATUS_LABEL: Record<VariationStatus, string> = { draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected" };
export const VARIATION_TONE: Record<VariationStatus, "blue" | "amber" | "green" | "red"> = { draft: "blue", submitted: "amber", approved: "green", rejected: "red" };

export const VARIATION_LIMITS = { titleMax: 200, descriptionMax: 2000, noteMax: 1000, changeRefMax: 100, amountMax: 999_999_999_999, maxPerProject: 500 } as const;

/** The approval request: one per variation, so several variations can wait at once. Same table and people as the budget baseline. */
export const VARIATION_APPROVAL_OBJECT = "contract_project_variations";
export const VARIATION_APPROVAL_KIND = "project_variation";
/** The reason an approved variation opens a budget revision with (a code in the workspace's justification list). */
export const VARIATION_REASON_CODE = "client_variation";
export const VARIATION_FALLBACK_REASON_CODE = "other";

export type VariationRow = {
  id: string;
  project_id: string;
  ref: string | null;
  title: string;
  description: string | null;
  status: VariationStatus;
  amount: number;
  cost_amount: number;
  change_request_ref: string | null;
  note: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  budget_revision_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VariationInput = {
  title: string;
  description: string | null;
  amount: number;
  cost_amount: number;
  change_request_ref: string | null;
  note: string | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && Math.abs(n) <= VARIATION_LIMITS.amountMax ? round2(n) : null;
}
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export type ParsedVariation = { ok: true; value: Partial<VariationInput> } | { ok: false; error: string };

/**
 * A create (title required) or an edit (any subset) from a request body. Amounts may be negative (an omission); a text that is too long
 * is cut, not refused; a number that is not a number is refused. Status, ref, who and when are never read from the body.
 */
export function parseVariation(body: unknown, mode: "create" | "update"): ParsedVariation {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: Partial<VariationInput> = {};
  if ("title" in b || mode === "create") {
    const title = text(b.title, VARIATION_LIMITS.titleMax);
    if (!title) return { ok: false, error: "Give the variation a title" };
    value.title = title;
  }
  if ("description" in b) value.description = text(b.description, VARIATION_LIMITS.descriptionMax);
  if ("note" in b) value.note = text(b.note, VARIATION_LIMITS.noteMax);
  if ("change_request_ref" in b) value.change_request_ref = text(b.change_request_ref, VARIATION_LIMITS.changeRefMax);
  for (const k of ["amount", "cost_amount"] as const) {
    if (!(k in b) && mode === "update") continue;
    const raw = b[k];
    if (raw === undefined || raw === null || raw === "") { value[k] = 0; continue; }
    const n = money(raw);
    if (n === null) return { ok: false, error: k === "amount" ? "The change in contract value must be a number" : "The change in cost must be a number" };
    value[k] = n;
  }
  return { ok: true, value };
}

export const isEditable = (status: VariationStatus): boolean => status === "draft" || status === "rejected";
export const isRemovable = (status: VariationStatus): boolean => status === "draft" || status === "rejected";

/** Why a variation cannot be sent for approval now, or null. */
export function submitProblem(v: Pick<VariationRow, "status" | "title" | "amount" | "cost_amount">): string | null {
  if (!isEditable(v.status)) return v.status === "submitted" ? "This variation is already waiting for approval" : "An approved variation cannot be sent again";
  if (!v.title.trim()) return "Give the variation a title";
  if (v.amount === 0 && v.cost_amount === 0) return "Give the change in contract value or the change in cost";
  return null;
}

/** Why a submitted variation cannot be approved now, or null. */
export function approveProblem(v: Pick<VariationRow, "status" | "amount">, project: { status: string; contract_value: number }): string | null {
  if (v.status !== "submitted") return "Only a variation waiting for approval can be decided";
  if (project.status === "closed") return "This project is closed";
  if (round2(project.contract_value + v.amount) < 0) return "Approving this would take the contract value below zero";
  return null;
}

export type VariationTotals = {
  count: number;
  /** Sum of approved variations, in contract value and in cost. */
  approved: number;
  approvedCost: number;
  /** Waiting for approval. */
  pending: number;
  pendingCount: number;
  /** The contract value now (original plus approved variations) and the original. */
  revised: number;
  original: number;
};

export function variationTotals(rows: readonly Pick<VariationRow, "status" | "amount" | "cost_amount">[], contractValue: number): VariationTotals {
  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "submitted");
  const sum = (list: readonly { amount: number }[]) => round2(list.reduce((s, r) => s + r.amount, 0));
  const approvedTotal = sum(approved);
  return {
    count: rows.length, approved: approvedTotal, approvedCost: round2(approved.reduce((s, r) => s + r.cost_amount, 0)),
    pending: sum(pending), pendingCount: pending.length, revised: round2(contractValue), original: round2(contractValue - approvedTotal),
  };
}

// ── What approval opens in the budget ───────────────────────────────────────────────────────────────────────────────

/** The note on the revision an approved variation opens: which variation, what it is, which change request. */
export function revisionNote(v: Pick<VariationRow, "ref" | "title" | "change_request_ref" | "cost_amount">): string {
  return [v.ref ?? "Variation", v.title, v.change_request_ref ? `change request ${v.change_request_ref}` : null, v.cost_amount < 0 ? `cost reduced by ${Math.abs(v.cost_amount)}: lower the matching lines` : null]
    .filter(Boolean).join(" · ").slice(0, 1000);
}

/**
 * The one budget line a cost increase adds to the new revision. It is a placeholder the team then splits into proper lines (its source
 * says so). A cost REDUCTION adds nothing: a budget line cannot be negative, so the note on the revision says to lower the matching lines.
 */
export function variationCostLine(v: Pick<VariationRow, "ref" | "title" | "cost_amount">, resourceCode: string | null): DraftLine | null {
  if (!(v.cost_amount > 0)) return null;
  return {
    line_key: null, resource_code: resourceCode, cost_code: null, wbs: null, description: `${v.ref ?? "Variation"}: ${v.title}`.slice(0, 500), qty: 1, unit: "lot",
    unit_cost: round2(v.cost_amount), cost_known: true, source_ref: `Variation ${v.ref ?? ""}: split into proper lines`.trim().slice(0, 300), reserve: false,
  };
}

// ── Telling people ──────────────────────────────────────────────────────────────────────────────────────────────────────

const label = (v: Pick<VariationRow, "ref" | "title">) => `${v.ref ? `${v.ref} ` : ""}${v.title}`.trim();
const signed = (n: number, currency: string | null) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${currency ? `${currency} ` : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The text of the request, kept on the approval row (what the approver reads first). */
export function requestReason(v: Pick<VariationRow, "ref" | "title" | "amount" | "cost_amount" | "change_request_ref">, currency: string | null): string {
  return [`Variation ${label(v)}`, `contract value ${signed(v.amount, currency)}`, `cost ${signed(v.cost_amount, currency)}`, v.change_request_ref ? `change request ${v.change_request_ref}` : null].filter(Boolean).join(", ").slice(0, 1000);
}

export function askMessage(args: { project: string; projectRef: string | null; variation: Pick<VariationRow, "ref" | "title">; proposer: string; reason: string; link: string | null }): { subject: string; text: string; comment: string } {
  const title = `${args.projectRef ? `${args.projectRef} ` : ""}${args.project}`.trim();
  const subject = `Approval needed: variation ${label(args.variation)} on ${title}`.slice(0, 200);
  const text = [
    `${args.proposer} asks you to approve a variation on the contract project "${title}".`,
    `Request: ${args.reason}`,
    args.link ? `Review and decide: ${args.link}` : "",
    "You are receiving this because you can approve project budgets in this workspace.",
  ].filter(Boolean).join("\n");
  return { subject, text, comment: `Asks you to approve variation ${label(args.variation)}: ${args.reason}`.slice(0, 600) };
}

export function outcomeMessage(args: { project: string; projectRef: string | null; variation: Pick<VariationRow, "ref" | "title">; decider: string; approved: boolean; comment: string | null; link: string | null }): { subject: string; text: string; comment: string } {
  const title = `${args.projectRef ? `${args.projectRef} ` : ""}${args.project}`.trim();
  const verdict = args.approved ? "approved" : "rejected";
  const subject = `${args.approved ? "Approved" : "Rejected"}: variation ${label(args.variation)} on ${title}`.slice(0, 200);
  const text = [
    `${args.decider} ${verdict} the variation ${label(args.variation)} on "${title}".`,
    args.comment ? `Comment: ${args.comment}` : "",
    args.approved ? "The contract value now includes it." : "It is back in draft; you can change it and send it again.",
    args.link ? `Open the project: ${args.link}` : "",
  ].filter(Boolean).join("\n");
  return { subject, text, comment: `${args.approved ? "Approved" : "Rejected"} variation ${label(args.variation)}${args.comment ? `: ${args.comment}` : ""}`.slice(0, 600) };
}
