import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { resolveCurrency } from "@/lib/currency";
import { readAllPages } from "@/lib/pagedRead";
import { selectedLines } from "@/lib/sales/lineTotals";
import { accountInTenant } from "@/lib/tender/server";
import { round2 } from "./budget";
import { mapTenderToBudget, type DealLine } from "./fromTender";
import { UUID_RE, type Failure, type ProjectCtx } from "./server";
import { cleanLabel, quoteElementType } from "@/lib/elements/fromQuote";
import type { DraftLine } from "./types";

// A contract project made from a quote that was accepted (docs/design/won-quote-to-project.md). The quote's CHARGED lines are the contract:
// each one a budget line with its quantity, unit and the client's rate and amount, no cost (nothing is guessed, as for a tender). The
// contract value is the quote's subtotal before tax, so tax and shipping never distort the margin. Every row is read tenant-scoped and every
// id the quote carries (account, deal) is verified again before it is used (MULTI_TENANT_GUARDRAILS.md).

export const QUOTE_SOURCE_TYPES = ["standard_quote", "quotation", "estimate"] as const;
export type QuoteSourceRequest = { type: (typeof QUOTE_SOURCE_TYPES)[number]; id: string };

/** The module and the workcenter of what a project is made from: the person must be able to open it, as for any other read of it. */
const SOURCE_ACCESS = {
  standard_quote: { feature: "standard_quotes", workcenter: "standard_quotes" },
  quotation: { feature: "quotations", workcenter: "quotations" },
  estimate: { feature: "estimator", workcenter: "estimates" },
} as const;

/** Is this module on for the workspace and may the caller view it? A miss is the same 404 as a record that does not exist. */
export async function canUseQuoteSource(req: Pick<ProjectCtx, "supabase" | "tenantId" | "userId" | "role">, type: QuoteSourceRequest["type"]): Promise<boolean> {
  const need = SOURCE_ACCESS[type];
  if (!(await tenantHasFeature(req.supabase, req.tenantId, need.feature))) return false;
  const perms = await resolvePermissions(req.supabase, req.tenantId, req.userId, req.role);
  return canViewWorkcenter(perms, need.workcenter);
}

export const QUOTE_BUDGET_NOTE ="Contract lines from the quote; costs to be allocated.";

export type QuoteSource = {
  title: string;
  accountId: string;
  currency: string | null;
  contractValue: number;
  lines: DraftLine[];
  unmappedCodes: string[];
  skipped: number;
  budgetNote: string;
  /** What the project records as its source: always the quote (an estimate resolves to the quote made from it). */
  source: { type: "standard_quote" | "quotation"; id: string; ref: string | null };
  /** The deal the quote belongs to, verified in this workspace: kept on the project for the back link only. */
  opportunityId: string | null;
  /** The estimate the quote was made from, when the request named one. */
  estimateId: string | null;
  /** 0253: the building label a quote line carries, by the budget line's source_line_id. Becomes a building when the project is made. */
  buildingLabels?: Record<string, string>;
};

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The quote's charged lines as budget lines, and how many rows were left out (an unchosen option, a quantity-break row, a deselected line). */
export function quoteLinesToBudget(rows: readonly Row[], opts: { selectedOptionId?: string | null } = {}): { lines: DraftLine[]; skipped: number; subtotal: number } {
  const lineOf = (r: Row) => ({
    id: String(r.id), amount: num(r.amount), group_id: str(r.group_id), group_type: str(r.group_type), break_of: str(r.break_of),
    break_qty: (r.break_qty as number | null | undefined) ?? null, is_selected: r.is_selected as boolean | null | undefined, row: r,
  });
  const charged = selectedLines(rows.map(lineOf), opts.selectedOptionId !== undefined ? { selectedOptionId: opts.selectedOptionId } : {});
  const deal: DealLine[] = charged.map(({ row }) => ({
    id: String(row.id), sl_no: str(row.sl_no), description: String(row.description ?? ""), uom: str(row.uom), qty: num(row.qty),
    rate: num(row.rate ?? row.unit_price), discount_pct: num(row.discount_pct), is_selected: row.is_selected as boolean | null | undefined, break_of: str(row.break_of),
  }));
  const mapped = mapTenderToBudget({ lines: deal, boq: new Map(), costCodes: new Set() });
  return { lines: mapped.lines, skipped: rows.length - mapped.lines.length, subtotal: round2(charged.reduce((s, l) => s + l.amount, 0)) };
}

async function accountName(admin: SupabaseClient, tenantId: string, accountId: string): Promise<string | null> {
  const { data } = await admin.from("accounts").select("name").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  return str((data as { name?: string } | null)?.name);
}

async function verifiedOpportunity(admin: SupabaseClient, tenantId: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  const { data, error } = await admin.from("opportunities").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return error ? null : (data as { id: string } | null)?.id ?? null;
}

const projectTitle = (account: string | null, ref: string | null): string => [account, ref].filter(Boolean).join(" - ").slice(0, 200) || "Contract project";

async function fromStandardQuote(admin: SupabaseClient, tenantId: string, id: string, estimateId: string | null): Promise<{ ok: true; source: QuoteSource } | ({ ok: false } & Failure)> {
  const { data: q } = await admin.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return { ok: false, status: 404, error: "Standard quote not found" };
  const quote = q as Row;
  if (quote.status !== "accepted") return { ok: false, status: 409, error: "Only an accepted standard quote becomes a contract project" };
  const accountId = quote.account_id as string;
  if (!accountId || !(await accountInTenant(admin, tenantId, accountId))) return { ok: false, status: 404, error: "Account not found" };
  const { data: rows, error } = await readAllPages((lo, hi) => admin.from("standard_quote_lines").select("*").eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no").order("id", { ascending: true }).range(lo, hi));
  if (error) return { ok: false, status: 500, error: error.message };
  const mapped = quoteLinesToBudget((rows ?? []) as Row[]);
  // The element type and the building label a quote line may carry (0253): the type goes on the budget line, the label becomes a building.
  const buildingLabels: Record<string, string> = {};
  const byId = new Map(((rows ?? []) as Row[]).map((r) => [String(r.id), r]));
  for (const l of mapped.lines) {
    const r = l.source_line_id ? byId.get(l.source_line_id) : undefined;
    if (!r || !l.source_line_id) continue;
    const type = quoteElementType(r.element_type);
    if (type) l.element_type = type;
    const label = cleanLabel(r.building);
    if (label) buildingLabels[l.source_line_id] = label;
  }
  const tenant = await getTenant();
  const stored = round2(num(quote.subtotal));
  const ref = str(quote.ref);
  return {
    ok: true,
    source: {
      title: projectTitle(await accountName(admin, tenantId, accountId), ref), accountId, currency: str(quote.currency) ?? resolveCurrency(tenant?.config).code,
      contractValue: stored > 0 ? stored : mapped.subtotal, lines: mapped.lines, unmappedCodes: [], skipped: mapped.skipped, budgetNote: QUOTE_BUDGET_NOTE,
      source: { type: "standard_quote", id, ref }, opportunityId: await verifiedOpportunity(admin, tenantId, quote.opportunity_id), estimateId, buildingLabels,
    },
  };
}

async function fromQuotation(admin: SupabaseClient, tenantId: string, id: string): Promise<{ ok: true; source: QuoteSource } | ({ ok: false } & Failure)> {
  const { data: q } = await admin.from("quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return { ok: false, status: 404, error: "Quotation not found" };
  const quote = q as Row;
  if (quote.superseded_by) return { ok: false, status: 409, error: "This quotation version has been superseded; use the latest version" };
  if (quote.outcome !== "won") return { ok: false, status: 409, error: "Only a won quotation becomes a contract project" };
  const accountId = quote.account_id as string;
  if (!accountId || !(await accountInTenant(admin, tenantId, accountId))) return { ok: false, status: 404, error: "Account not found" };
  const { data: rows, error } = await readAllPages((lo, hi) => admin.from("quote_lines").select("*").eq("quote_id", id).eq("tenant_id", tenantId).order("sl_no").order("id", { ascending: true }).range(lo, hi));
  if (error) return { ok: false, status: 500, error: error.message };
  const mapped = quoteLinesToBudget((rows ?? []) as Row[], { selectedOptionId: (quote.selected_option_id as string | null) ?? null });
  const tenant = await getTenant();
  const ref = str(quote.ref);
  return {
    ok: true,
    source: {
      title: projectTitle(await accountName(admin, tenantId, accountId), ref), accountId, currency: str(quote.currency) ?? resolveCurrency(tenant?.config).code,
      contractValue: mapped.subtotal, lines: mapped.lines, unmappedCodes: [], skipped: mapped.skipped, budgetNote: QUOTE_BUDGET_NOTE,
      source: { type: "quotation", id, ref }, opportunityId: await verifiedOpportunity(admin, tenantId, quote.opportunity_id), estimateId: null,
    },
  };
}

/** What an accepted quote of this workspace gives a project: its lines as the contract, its account and its contract value. */
export async function loadQuoteSource(admin: SupabaseClient, tenantId: string, req: QuoteSourceRequest): Promise<{ ok: true; source: QuoteSource } | ({ ok: false } & Failure)> {
  if (!UUID_RE.test(req.id)) return { ok: false, status: 404, error: req.type === "estimate" ? "Estimate not found" : req.type === "quotation" ? "Quotation not found" : "Standard quote not found" };
  if (req.type === "standard_quote") return fromStandardQuote(admin, tenantId, req.id, null);
  if (req.type === "quotation") return fromQuotation(admin, tenantId, req.id);
  const { data: e } = await admin.from("estimates").select("id, standard_quote_id").eq("id", req.id).eq("tenant_id", tenantId).maybeSingle();
  if (!e) return { ok: false, status: 404, error: "Estimate not found" };
  const quoteId = (e as { standard_quote_id: string | null }).standard_quote_id;
  if (!quoteId) return { ok: false, status: 409, error: "This estimate has no standard quote yet. Make the quote from the estimate first." };
  return fromStandardQuote(admin, tenantId, quoteId, req.id);
}
