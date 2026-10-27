// Invoicing milestones of a contract project (docs/design/gcc-tender-deals.md section 23, migration 0232): the billing schedule. PURE: no I/O
// and no server imports, so the routes, the screen and the tests share one set of rules.
//
// A milestone is an amount to bill at a point in the project: a percent of the CURRENT (revised) contract value, so an approved variation
// moves it, or a fixed amount. Percent milestones are meant to total at most 100 percent; that is a warning, never a block. "Create invoice"
// makes a draft invoice through the invoices object and links it both ways (the milestone's invoice_id, and the invoice's custom_data).

export const MILESTONE_STATUSES = ["planned", "ready", "invoiced", "paid"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = { planned: "Planned", ready: "Ready to invoice", invoiced: "Invoiced", paid: "Paid" };
export const MILESTONE_TONE: Record<MilestoneStatus, "blue" | "amber" | "teal" | "green"> = { planned: "blue", ready: "amber", invoiced: "teal", paid: "green" };

export const MILESTONE_BASES = ["percent", "fixed"] as const;
export type MilestoneBasis = (typeof MILESTONE_BASES)[number];

export const MILESTONE_LIMITS = { titleMax: 200, noteMax: 1000, amountMax: 999_999_999_999, maxPerProject: 200 } as const;

/** Where the invoice keeps its way back to the project (invoices.custom_data). */
export const INVOICE_PROJECT_KEY = "source_contract_project_id";
export const INVOICE_MILESTONE_KEY = "source_contract_project_milestone_id";

export type MilestoneRow = {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  basis: MilestoneBasis;
  percent: number | null;
  fixed_amount: number | null;
  status: MilestoneStatus;
  invoice_id: string | null;
  sort_order: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MilestoneInput = {
  title: string;
  due_date: string | null;
  basis: MilestoneBasis;
  percent: number | null;
  fixed_amount: number | null;
  note: string | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const numberOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export type ParsedMilestone = { ok: true; value: Partial<MilestoneInput> } | { ok: false; error: string };

/**
 * A create (title and an amount required) or an edit (any subset) from a request body. Percent is 0 to 100, a fixed amount 0 or more.
 * Status, invoice, order and author are never read from the body.
 */
export function parseMilestone(body: unknown, mode: "create" | "update"): ParsedMilestone {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: Partial<MilestoneInput> = {};
  if ("title" in b || mode === "create") {
    const title = text(b.title, MILESTONE_LIMITS.titleMax);
    if (!title) return { ok: false, error: "Give the milestone a title" };
    value.title = title;
  }
  if ("due_date" in b) {
    if (b.due_date === null || b.due_date === "") value.due_date = null;
    else if (typeof b.due_date === "string" && DATE.test(b.due_date) && !Number.isNaN(Date.parse(b.due_date))) value.due_date = b.due_date;
    else return { ok: false, error: "The due date must be a date" };
  }
  if ("note" in b) value.note = text(b.note, MILESTONE_LIMITS.noteMax);

  if ("basis" in b || mode === "create") {
    const basis = b.basis === undefined && mode === "create" ? "percent" : b.basis;
    if (basis !== "percent" && basis !== "fixed") return { ok: false, error: "The amount is a percent of the contract value or a fixed amount" };
    value.basis = basis;
  }
  const basis = value.basis ?? (b.basis === "fixed" ? "fixed" : b.basis === "percent" ? "percent" : null);
  if ("percent" in b || (mode === "create" && basis === "percent")) {
    const n = numberOf(b.percent);
    if (basis !== "fixed" && (n === null || n < 0 || n > 100)) return { ok: false, error: "The percent must be between 0 and 100" };
    value.percent = basis === "fixed" ? null : round2(n as number);
  }
  if ("fixed_amount" in b || (mode === "create" && basis === "fixed")) {
    const n = numberOf(b.fixed_amount);
    if (basis !== "percent" && (n === null || n < 0 || n > MILESTONE_LIMITS.amountMax)) return { ok: false, error: "The amount must be a number of 0 or more" };
    value.fixed_amount = basis === "percent" ? null : round2(n as number);
  }
  return { ok: true, value };
}

/** What a milestone bills: its percent of the contract value as it stands, or its fixed amount. */
export function milestoneAmount(m: Pick<MilestoneRow, "basis" | "percent" | "fixed_amount">, contractValue: number): number {
  return m.basis === "percent" ? round2((contractValue * (Number(m.percent) || 0)) / 100) : round2(Number(m.fixed_amount) || 0);
}

/** A milestone whose invoice was paid reads as paid even if nobody ticked it; one whose invoice was cancelled reads as ready again. */
export function effectiveStatus(m: Pick<MilestoneRow, "status" | "invoice_id">, invoiceStatus: string | null | undefined): MilestoneStatus {
  if (m.status === "invoiced" && invoiceStatus === "paid") return "paid";
  if ((m.status === "invoiced" || m.status === "paid") && m.invoice_id && invoiceStatus === "cancelled") return "ready";
  return m.status;
}

/** The amount and dates may change until an invoice has been raised; the title, date and note may always change. */
export const amountEditable = (status: MilestoneStatus): boolean => status === "planned" || status === "ready";
export const isRemovable = (m: Pick<MilestoneRow, "status" | "invoice_id">): boolean => !m.invoice_id && (m.status === "planned" || m.status === "ready");

/** The statuses a person may set by hand: planned and ready both ways, and paid once invoiced. Invoiced only ever comes from Create invoice. */
export function statusChangeProblem(from: MilestoneStatus, to: MilestoneStatus): string | null {
  if (from === to) return null;
  if ((from === "planned" && to === "ready") || (from === "ready" && to === "planned")) return null;
  if (from === "invoiced" && to === "paid") return null;
  if (to === "invoiced") return "A milestone becomes invoiced when you create its invoice";
  return from === "invoiced" || from === "paid" ? "An invoiced milestone cannot go back. Cancel the invoice instead" : "That change is not allowed";
}

export type MilestoneTotals = {
  count: number;
  /** The contract value (the revised one). */
  contracted: number;
  /** What the schedule adds up to. */
  scheduled: number;
  invoiced: number;
  paid: number;
  /** contracted less invoiced. */
  toInvoice: number;
  percentTotal: number;
  /** A sentence when the schedule is out of step with the contract, else null. A warning, never a block. */
  warning: string | null;
};

export function milestoneTotals(
  rows: readonly (Pick<MilestoneRow, "basis" | "percent" | "fixed_amount" | "status" | "invoice_id"> & { invoice_status?: string | null })[],
  contractValue: number,
): MilestoneTotals {
  let scheduled = 0, invoiced = 0, paid = 0, percentTotal = 0;
  for (const r of rows) {
    const amount = milestoneAmount(r, contractValue);
    const st = effectiveStatus(r, r.invoice_status);
    scheduled += amount;
    if (r.basis === "percent") percentTotal += Number(r.percent) || 0;
    if (st === "invoiced" || st === "paid") invoiced += amount;
    if (st === "paid") paid += amount;
  }
  const t: MilestoneTotals = {
    count: rows.length, contracted: round2(contractValue), scheduled: round2(scheduled), invoiced: round2(invoiced), paid: round2(paid),
    toInvoice: round2(contractValue - invoiced), percentTotal: round2(percentTotal), warning: null,
  };
  t.warning = scheduleWarning(t);
  return t;
}

export function scheduleWarning(t: Pick<MilestoneTotals, "percentTotal" | "scheduled" | "contracted">): string | null {
  if (t.percentTotal > 100.005) return `The percent milestones add up to ${t.percentTotal}%. They should total at most 100%`;
  if (t.contracted > 0 && t.scheduled > t.contracted + 0.005) return "The schedule adds up to more than the contract value";
  return null;
}

// ── The invoice a milestone makes ───────────────────────────────────────────────────────────────────────────────────────

/** Why "Create invoice" is not available for this milestone now, or null. */
export function invoiceProblem(args: { milestone: Pick<MilestoneRow, "status" | "invoice_id">; invoiceStatus: string | null | undefined; amount: number; accountId: string | null; projectClosed: boolean }): string | null {
  if (args.projectClosed) return "This project is closed";
  if (!args.accountId) return "Give the project a customer first: an invoice needs one";
  const st = effectiveStatus(args.milestone, args.invoiceStatus);
  if (st === "invoiced" || st === "paid") return "This milestone already has an invoice";
  if (!(args.amount > 0)) return "The milestone has no amount to invoice";
  return null;
}

/** The body of the invoice (the shape POST /api/invoices takes): one line for the milestone, due on its due date, noting where it came from. */
export function invoiceBody(args: { accountId: string; projectRef: string | null; projectName: string; milestone: Pick<MilestoneRow, "title" | "due_date">; amount: number }) {
  const where = [args.projectRef, args.projectName].filter(Boolean).join(" ");
  return {
    account_id: args.accountId,
    due_date: args.milestone.due_date ?? null,
    notes: `Contract project ${where} · milestone: ${args.milestone.title}`.slice(0, 1000),
    lines: [{ sl_no: "1", description: `${args.milestone.title} (${where})`.slice(0, 500), uom: "lot", qty: 1, rate: args.amount }],
  };
}
