import {
  DOCUMENT_STATES, PAID_BY, SITE_LIMITS, isUuid,
  type DocumentState, type ExpenseFlag, type ExpenseStatus, type PaidBy, type SiteConfig,
} from "./types";

// The rules of a site expense, pure: what a typed or read-from-photo expense must look like, what counts as cost and when, who may
// decide it, which warnings it carries. No I/O, so the route, the screen and the tests share one reading.

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const money = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date of `iso` in UTC as YYYY-MM-DD, or null when it is not a real date. */
export function cleanDate(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export type ExpenseInput = {
  client_id: string;
  project_id: string;
  category_id: string | null;
  line_key: string | null;
  wbs_code: string | null;
  expense_date: string;
  amount: number;
  currency: string;
  amount_project_ccy: number | null;
  vat_amount: number | null;
  vendor_text: string | null;
  document_state: DocumentState;
  invoice_ref: string | null;
  paid_by: PaidBy;
  note: string | null;
  source_type: string | null;
  source_id: string | null;
  ai_read: Record<string, unknown> | null;
};

export type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * What a person typed (or the photo reader proposed and they confirmed), as the row it becomes. Nothing here trusts the client: every
 * foreign id is only SHAPE-checked here (a uuid or null) and tenant-verified by the route, and `today` is the server's.
 */
export function cleanExpenseInput(body: Record<string, unknown>, opts: { today: string; projectCurrency: string; requireClientId?: boolean }): Cleaned<ExpenseInput> {
  const clientId = body.client_id;
  if (opts.requireClientId !== false && !isUuid(clientId)) return { ok: false, error: "client_id must be a uuid" };
  if (!isUuid(body.project_id)) return { ok: false, error: "Choose the project" };
  const amount = money(body.amount);
  if (amount === null || !(amount > 0)) return { ok: false, error: "Enter the amount" };
  if (amount > SITE_LIMITS.maxAmount) return { ok: false, error: "That amount is too large" };
  const date = cleanDate(body.expense_date);
  if (!date) return { ok: false, error: "Enter the date the money was spent" };
  const limit = new Date(`${opts.today}T00:00:00Z`);
  if (new Date(`${date}T00:00:00Z`).getTime() > limit.getTime() + 86_400_000) return { ok: false, error: "The date is in the future" };
  if (new Date(`${date}T00:00:00Z`).getTime() < limit.getTime() - SITE_LIMITS.backdateDays * 86_400_000) return { ok: false, error: "The date is more than a year ago" };
  const currency = (typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency.trim()) ? body.currency.trim().toUpperCase() : opts.projectCurrency).slice(0, 3);
  const vat = body.vat_amount === null || body.vat_amount === undefined || body.vat_amount === "" ? null : money(body.vat_amount);
  if (body.vat_amount !== null && body.vat_amount !== undefined && body.vat_amount !== "" && (vat === null || vat < 0 || vat > amount)) return { ok: false, error: "The VAT amount cannot be more than the amount" };
  const ownCcy = currency === opts.projectCurrency;
  const inProject = ownCcy ? amount : (body.amount_project_ccy === undefined || body.amount_project_ccy === null || body.amount_project_ccy === "" ? null : money(body.amount_project_ccy));
  if (!ownCcy && inProject !== null && (!(inProject > 0) || inProject > SITE_LIMITS.maxAmount)) return { ok: false, error: "The amount in the project currency is not valid" };
  const paid = typeof body.paid_by === "string" && (PAID_BY as readonly string[]).includes(body.paid_by) ? (body.paid_by as PaidBy) : "company";
  const doc = typeof body.document_state === "string" && (DOCUMENT_STATES as readonly string[]).includes(body.document_state) ? (body.document_state as DocumentState) : "receipt_attached";
  const ai = body.ai_read && typeof body.ai_read === "object" && !Array.isArray(body.ai_read) ? (body.ai_read as Record<string, unknown>) : null;
  return {
    ok: true,
    value: {
      client_id: typeof clientId === "string" ? clientId : "",
      project_id: body.project_id,
      category_id: isUuid(body.category_id) ? body.category_id : null,
      line_key: isUuid(body.line_key) ? body.line_key : null,
      wbs_code: text(body.wbs_code, 50),
      expense_date: date,
      amount: round2(amount),
      currency,
      amount_project_ccy: inProject === null ? null : round2(inProject),
      vat_amount: vat === null ? null : round2(vat),
      vendor_text: text(body.vendor_text, 200),
      document_state: doc,
      invoice_ref: text(body.invoice_ref, 100),
      paid_by: paid,
      note: text(body.note, 1000),
      source_type: text(body.source_type, 40),
      source_id: isUuid(body.source_id) ? body.source_id : null,
      ai_read: ai && JSON.stringify(ai).length <= 4000 ? ai : null,
    },
  };
}

/** The fields a submitter may change on an expense that was returned to them (never the project, the client id or the money state). */
export const EXPENSE_RESUBMIT_FIELDS = ["category_id", "line_key", "wbs_code", "expense_date", "amount", "currency", "amount_project_ccy", "vat_amount", "vendor_text", "document_state", "invoice_ref", "paid_by", "note"] as const;
/** The fields the deciding person may set while approving (assigning a "Not sure" line, the project-currency amount, the category). */
export const EXPENSE_APPROVER_FIELDS = ["category_id", "line_key", "amount_project_ccy", "wbs_code"] as const;

// ── What counts as cost ────────────────────────────────────────────────────────────────────────────────────────────

export type CountedExpense = { status: ExpenseStatus | string; amount: number; currency: string; amount_project_ccy: number | null; posted_amount: number | null; erp_state: string };

/** The amount in the project's currency, or null while it is waiting for the approver to enter it. */
export function projectAmount(e: Pick<CountedExpense, "amount" | "currency" | "amount_project_ccy">, projectCurrency: string | null): number | null {
  if (e.amount_project_ccy !== null && e.amount_project_ccy !== undefined) return Number(e.amount_project_ccy);
  if (!projectCurrency || e.currency === projectCurrency) return Number(e.amount);
  return null;
}

/**
 * What an expense adds to "cost to date" on its budget line. Waiting and returned ones add nothing (waiting is exposure, shown apart),
 * an approved one adds its project-currency amount at once, and a posted one adds what the ERP posted INSTEAD (never both).
 */
export function recordedAmount(e: CountedExpense, projectCurrency: string | null): number {
  if (e.status !== "approved") return 0;
  if (e.erp_state === "posted" && e.posted_amount !== null && e.posted_amount !== undefined) return Number(e.posted_amount);
  return projectAmount(e, projectCurrency) ?? 0;
}

/** Waiting exposure, recorded (approved, not yet posted) and posted, in the project currency. A foreign amount nobody converted yet is counted apart. */
export function exposureTotals(list: readonly CountedExpense[], projectCurrency: string | null): { waiting: number; recorded: number; posted: number; unconverted: number } {
  let waiting = 0, recorded = 0, posted = 0, unconverted = 0;
  for (const e of list) {
    const amt = projectAmount(e, projectCurrency);
    if (e.status === "submitted") { if (amt === null) unconverted++; else waiting += amt; continue; }
    if (e.status !== "approved") continue;
    if (e.erp_state === "posted" && e.posted_amount !== null && e.posted_amount !== undefined) posted += Number(e.posted_amount);
    else if (amt === null) unconverted++;
    else recorded += amt;
  }
  return { waiting: round2(waiting), recorded: round2(recorded), posted: round2(posted), unconverted };
}

// ── Warnings: shown, never blocking ────────────────────────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
const dayNumber = (d: string): number => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 86_400_000);

export type DuplicateCandidate = { id?: string; project_id: string; amount: number; currency: string; vendor_text: string | null; expense_date: string; status: string; photo_hash?: string | null };

/**
 * An earlier expense of the same project with the same amount and vendor within 60 days, or with the very same photo. A returned or
 * cancelled one never counts: re-entering a cancelled expense is the normal way to correct it.
 */
export function findDuplicate(candidate: DuplicateCandidate, existing: readonly DuplicateCandidate[]): DuplicateCandidate | null {
  const vendor = norm(candidate.vendor_text);
  for (const e of existing) {
    if (e.id && candidate.id && e.id === candidate.id) continue;
    if (e.project_id !== candidate.project_id) continue;
    if (e.status === "cancelled" || e.status === "rejected") continue;
    if (candidate.photo_hash && e.photo_hash && candidate.photo_hash === e.photo_hash) return e;
    if (!vendor || norm(e.vendor_text) !== vendor) continue;
    if (e.currency !== candidate.currency || Math.abs(Number(e.amount) - candidate.amount) >= 0.005) continue;
    if (Math.abs(dayNumber(e.expense_date) - dayNumber(candidate.expense_date)) <= SITE_LIMITS.dupWindowDays) return e;
  }
  return null;
}

/** The warnings an expense carries when it is submitted. `monthSoFar` is the submitter's own submitted and approved total this month (project currency). */
export function expenseFlags(args: { amountInProject: number | null; categoryLimit: number | null; config: SiteConfig | null | undefined; monthSoFar: number; hasLine: boolean; duplicate: boolean }): ExpenseFlag[] {
  const out: ExpenseFlag[] = [];
  if (args.duplicate) out.push("duplicate");
  const cfg = args.config ?? {};
  if (args.amountInProject !== null) {
    const limit = [args.categoryLimit, cfg.pm_limit ?? null].filter((x): x is number => typeof x === "number" && x > 0);
    if (limit.length > 0 && args.amountInProject > Math.min(...limit)) out.push("over_limit");
    if (typeof cfg.monthly_cap === "number" && cfg.monthly_cap > 0 && args.monthSoFar + args.amountInProject > cfg.monthly_cap) out.push("over_cap");
  }
  if (!args.hasLine) out.push("no_line");
  return out;
}

// ── Who may decide ─────────────────────────────────────────────────────────────────────────────────────────────────

export type DecideContext = {
  actorId: string;
  actorIsAdmin: boolean;
  submitterId: string;
  managerId: string | null;
  /** Settings > Tenders approvers (workspace admins by default): the cost approvers. */
  costApprovers: readonly string[];
  allowSelfApproval: boolean;
  /** The amount in the project currency; null while a foreign amount is waiting for it (the approver then enters it). */
  amountInProject: number | null;
  categoryLimit: number | null;
  config: SiteConfig | null | undefined;
};

export type DecideResult = { ok: true; level: "manager" | "cost" } | { ok: false; status: 403 | 409; error: string };

/**
 * May this person approve (or return) this expense? The project manager decides what is within the limit; a cost approver (or an admin)
 * decides anything. Nobody decides their own unless the workspace's self-approval switch is on. Above the limit the manager alone is not enough.
 */
export function canDecideExpense(ctx: DecideContext): DecideResult {
  const isCost = ctx.actorIsAdmin || ctx.costApprovers.includes(ctx.actorId);
  const isManager = !!ctx.managerId && ctx.managerId === ctx.actorId;
  if (!isCost && !isManager) return { ok: false, status: 403, error: "Only the project manager or a cost approver can decide this expense" };
  if (ctx.actorId === ctx.submitterId && !ctx.allowSelfApproval) return { ok: false, status: 403, error: "You cannot decide your own expense. Another approver must" };
  if (!isCost) {
    const limits = [ctx.categoryLimit, ctx.config?.pm_limit ?? null].filter((x): x is number => typeof x === "number" && x > 0);
    if (limits.length > 0 && ctx.amountInProject !== null && ctx.amountInProject > Math.min(...limits)) {
      return { ok: false, status: 403, error: "This is over your limit. A cost approver must approve it" };
    }
  }
  return { ok: true, level: isCost ? "cost" : "manager" };
}

/** Who may cancel: the submitter while it waits or is returned; a decider until the ERP has it. */
export function canCancelExpense(args: { status: string; erpState: string; actorId: string; submitterId: string; isDecider: boolean }): { ok: true } | { ok: false; error: string } {
  if (args.status === "cancelled") return { ok: false, error: "It is already cancelled" };
  if (args.erpState === "sent" || args.erpState === "posted") return { ok: false, error: "The ERP has this expense. Ask finance to reverse it there" };
  if (args.actorId === args.submitterId && (args.status === "submitted" || args.status === "rejected")) return { ok: true };
  if (args.isDecider && (args.status === "submitted" || args.status === "approved" || args.status === "rejected")) return { ok: true };
  return { ok: false, error: "You cannot cancel this expense" };
}

/** Does the deciding person need to give a reason? Returning an expense, always. */
export const needsReason = (action: "approve" | "reject" | "cancel", byDecider: boolean): boolean => action === "reject" || (action === "cancel" && byDecider);

export const reasonProblem = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length < 3) return "Give a short reason (at least 3 characters)";
  if (t.length > 1000) return "The reason is too long";
  return null;
};
