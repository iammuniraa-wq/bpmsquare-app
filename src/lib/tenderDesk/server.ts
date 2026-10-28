import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { normaliseProject } from "@/lib/contractProjects/server";
import { buildSummary, type BuyoutCtx } from "@/lib/contractProjects/buyout/server";
import { resolveCurrency } from "@/lib/currency";
import { createAdminSupabase } from "@/lib/supabase-server";
import { APPROVAL_KIND_TENDER_BID, APPROVAL_OBJECT_TENDER } from "@/lib/tender/approval";
import { priceValidityDays } from "@/lib/tender/boq/price";
import { dayKey, tenderStages } from "@/lib/tender/rules";
import { isMissingSchema, listTenders } from "@/lib/tender/server";
import {
  composeTenderDesk, dealsClosingWithin, dealsWithOpenGuarantee, DESK_STALE_WINDOW_DAYS, DESK_UNPRICED_WINDOW_DAYS, emptyTenderDesk, pricedDealIds, staleLineCounts,
  type BoqPriceLine, type DecisionRequest, type DeskProject, type DeskTender, type RfqWait,
} from "./rules";
import type { TenderDeskData } from "./types";

// The Tender desk home screen's data (docs/design/tender-desk.md). Server-only. Every query runs on the service-role client and carries
// its own `.eq("tenant_id", tenantId)` (MULTI_TENANT_GUARDRAILS.md); the tenant id is the caller's, never read from a request. A table or
// column that is not there yet (migration pending: 42P01, 42703, PGRST204, PGRST205) hides its part of the screen and never throws; the
// tender and deal tables themselves missing reads as `pending: true`. All arithmetic lives in rules.ts.

/** The zone tender dates are read in when the workspace has not set one (the tender edition is a Gulf edition). */
export const DESK_DEFAULT_TIMEZONE = "Asia/Riyadh";
/** The buy-out card sums at most this many contract projects, newest first. */
const PROJECTS_SHOWN = 10;
/** PostgREST answers at most this many rows per request (the same cap `fetchAllRows` in src/lib/import/server.ts pages around). */
const PAGE_SIZE = 1000;
/** Pages read per id slice before giving up: 50 x 1000 rows is far beyond any BOQ or line set one slice of 100 deals can carry. */
const MAX_PAGES = 50;

type Row = Record<string, unknown>;
type Err = { code?: string; message?: string } | null;

const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function validZone(zone: unknown): string {
  if (typeof zone !== "string" || !zone) return DESK_DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); return zone; } catch { return DESK_DEFAULT_TIMEZONE; }
}

/**
 * Rows of `table` whose `column` is in `ids`, tenant-scoped, read in slices of 100 ids and, within a slice, in pages of 1000 rows: a
 * `.limit()` above the cap is silently cut to 1000 by PostgREST, which would drop the BOQ lines of a busy fortnight unnoticed. The pages
 * are ordered by id so no row is skipped or repeated between them. `ok` is false when the table or a column is not there (or the read failed).
 */
async function readIn(admin: SupabaseClient, tenantId: string, table: string, cols: string, column: string, ids: readonly string[], extra?: (q: any) => any): Promise<{ rows: Row[]; ok: boolean; missing: boolean }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Row[] = [];
  for (const part of chunks([...new Set(ids)], 100)) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = admin.from(table).select(cols).eq("tenant_id", tenantId).in(column, part);
      if (extra) q = extra(q);
      const from = page * PAGE_SIZE;
      const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) return failed(table, error);
      const got = (data ?? []) as unknown as Row[];
      rows.push(...got);
      if (got.length < PAGE_SIZE) break;
    }
  }
  return { rows, ok: true, missing: false };
}

function failed(table: string, error: Err): { rows: Row[]; ok: false; missing: boolean } {
  const missing = isMissingSchema(error);
  if (!missing) console.error(`[tenderDesk] ${table} could not be read`, error?.message);
  return { rows: [], ok: false, missing };
}

/**
 * `modules` is what the workspace owns (its feature flags). The desk shows only what the workspace is scoped for: without the RFQ module
 * there is no "supplier reply overdue" item and the RFQ tables are not read; without Contract projects there is no buy-out and the project
 * tables are not read. Left out (undefined), every module counts as owned, which is what the tests and tools that already pass no flags expect.
 */
export type DeskModules = { rfq?: boolean; contract_projects?: boolean };

export async function getTenderDeskData(tenantId: string, opts: { now?: Date; modules?: DeskModules } = {}): Promise<TenderDeskData> {
  const hasRfq = opts.modules?.rfq !== false;
  const hasProjects = opts.modules?.contract_projects !== false;
  const now = opts.now ?? new Date();
  const admin = createAdminSupabase();

  const { data: tenantRow } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = ((tenantRow?.config ?? {}) as TenantConfig) ?? {};
  const currency = resolveCurrency(config).code;
  const timezone = validZone(config.wfm?.timezone);
  const pendingData = emptyTenderDesk({ now, currency, pending: true });

  const { rows: tenderRows, pending } = await listTenders(admin, tenantId);
  if (pending) return pendingData;

  const deals = await readIn(admin, tenantId, "opportunities", "id, ref, title, account_id, stage, outcome, amount, probability, created_at, closed_at", "id", tenderRows.map((t) => t.opportunity_id));
  if (!deals.ok) return pendingData;
  const dealById = new Map(deals.rows.map((d) => [d.id as string, d]));

  const accountIds = [...dealById.values()].flatMap((d) => [str(d.account_id)]).concat(tenderRows.map((t) => t.issuer_account_id)).filter((x): x is string => !!x);
  const accounts = await readIn(admin, tenantId, "accounts", "id, name", "id", accountIds);
  const accountName = new Map(accounts.rows.map((a) => [a.id as string, str(a.name)]));

  const tenders: (DeskTender & { bondExpiry: string | null; bondReleased: boolean })[] = [];
  for (const t of tenderRows) {
    const d = dealById.get(t.opportunity_id);
    if (!d) continue;
    const clientId = t.issuer_account_id ?? str(d.account_id);
    tenders.push({
      id: t.opportunity_id, ref: str(d.ref), title: str(d.title) ?? "Tender", stage: str(d.stage) ?? "", outcome: str(d.outcome) ?? "open",
      amount: num(d.amount), probability: num(d.probability), closingAt: t.closing_at, createdAt: str(d.created_at) ?? "", closedAt: str(d.closed_at),
      // The issuer account, else the typed issuer name, else the deal's own account.
      clientName: (t.issuer_account_id ? accountName.get(t.issuer_account_id) : null) ?? t.issuer_name ?? accountName.get(str(d.account_id) ?? "") ?? null,
      clientAccountId: clientId,
      bondExpiry: t.bid_bond_expiry, bondReleased: t.bond_status === "released",
    });
  }
  const todayKey = dayKey(now, timezone);

  const [decisions, rfqWaits, boq, projects] = await Promise.all([
    loadDecisions(admin, tenantId, tenders),
    hasRfq ? loadRfqWaits(admin, tenantId, todayKey) : Promise.resolve<RfqWait[]>([]),
    loadBoq(admin, tenantId, dealsClosingWithin(tenders, now, timezone, DESK_STALE_WINDOW_DAYS).map((t) => t.id)),
    hasProjects ? loadProjects(admin, tenantId, tenders.map((t) => t.id)) : Promise.resolve<DeskProject[]>([]),
  ]);

  const near = dealsClosingWithin(tenders, now, timezone, DESK_STALE_WINDOW_DAYS);
  const validityDays = priceValidityDays(config);
  const staleCounts = staleLineCounts(boq.lines, todayKey, validityDays);
  const stale = near.filter((t) => (staleCounts.get(t.id) ?? 0) > 0).map((t) => ({ opportunityId: t.id, title: t.title, closingAt: t.closingAt, staleLines: staleCounts.get(t.id) ?? 0 }));

  const veryNear = dealsClosingWithin(tenders, now, timezone, DESK_UNPRICED_WINDOW_DAYS);
  const lined = await pricedByLines(admin, tenantId, veryNear.map((t) => t.id));
  const pricedInBoq = pricedDealIds(boq.lines);
  const unpriced = veryNear.filter((t) => !pricedInBoq.has(t.id) && !lined.has(t.id)).map((t) => ({ opportunityId: t.id, title: t.title, closingAt: t.closingAt }));

  return composeTenderDesk({
    now, timezone, currency, pending: false, stageDefs: tenderStages(), tenders, projects, decisions, rfqWaits, bonds: dealsWithOpenGuarantee(tenders), stale, unpriced, validityDays,
  });
}

/** Bid / no-bid proposals waiting for a manager (migration 0221). */
async function loadDecisions(admin: SupabaseClient, tenantId: string, tenders: readonly DeskTender[]): Promise<DecisionRequest[]> {
  const { data, error } = await admin.from("approval_requests").select("object_id, proposed_value, created_at")
    .eq("tenant_id", tenantId).eq("object_type", APPROVAL_OBJECT_TENDER).eq("kind", APPROVAL_KIND_TENDER_BID).eq("status", "pending").limit(500);
  if (error) { failed("approval_requests", error); return []; }
  const byId = new Map(tenders.map((t) => [t.id, t]));
  const out: DecisionRequest[] = [];
  for (const r of (data ?? []) as Row[]) {
    const t = byId.get(r.object_id as string);
    if (!t || (r.proposed_value !== "go" && r.proposed_value !== "no_go")) continue;
    out.push({ opportunityId: t.id, title: t.title, proposed: r.proposed_value, createdAt: str(r.created_at) ?? "", closingAt: t.closingAt });
  }
  return out;
}

/** RFQs sent to suppliers whose reply date has passed, with how many suppliers have not answered (migration 0128). */
async function loadRfqWaits(admin: SupabaseClient, tenantId: string, todayKey: string): Promise<RfqWait[]> {
  const { data, error } = await admin.from("rfqs").select("id, ref, title, respond_by")
    .eq("tenant_id", tenantId).in("status", ["sent", "partially_replied"]).lt("respond_by", todayKey).limit(500);
  if (error) { failed("rfqs", error); return []; }
  const rfqs = (data ?? []) as Row[];
  if (rfqs.length === 0) return [];
  const sups = await readIn(admin, tenantId, "rfq_suppliers", "rfq_id, status", "rfq_id", rfqs.map((r) => r.id as string), (q) => q.in("status", ["sent", "viewed"]));
  const waiting = new Map<string, number>();
  for (const s of sups.rows) waiting.set(s.rfq_id as string, (waiting.get(s.rfq_id as string) ?? 0) + 1);
  return rfqs.map((r) => ({ rfqId: r.id as string, ref: str(r.ref), title: str(r.title) ?? "RFQ", respondBy: String(r.respond_by ?? "").slice(0, 10), waiting: waiting.get(r.id as string) ?? 0 }));
}

/** The BOQ lines of the deals closing soon, with the facts the price checks need (migration 0223). */
async function loadBoq(admin: SupabaseClient, tenantId: string, dealIds: readonly string[]): Promise<{ lines: BoqPriceLine[] }> {
  if (dealIds.length === 0) return { lines: [] };
  const r = await readIn(admin, tenantId, "tender_boq_lines", "opportunity_id, price_source, price_as_of, stale_accepted, removed_in_revision", "opportunity_id", dealIds);
  return {
    lines: r.rows.map((x) => ({
      opportunityId: x.opportunity_id as string, priceSource: str(x.price_source), priceAsOf: typeof x.price_as_of === "string" ? x.price_as_of.slice(0, 10) : null,
      staleAccepted: x.stale_accepted === true, removed: x.removed_in_revision === true,
    })),
  };
}

/** Deals with at least one deal line that carries a rate (a deal priced without a BOQ upload). */
async function pricedByLines(admin: SupabaseClient, tenantId: string, dealIds: readonly string[]): Promise<Set<string>> {
  if (dealIds.length === 0) return new Set();
  const r = await readIn(admin, tenantId, "opportunity_lines", "opportunity_id, rate", "opportunity_id", dealIds);
  return new Set(r.rows.filter((x) => (num(x.rate) ?? 0) > 0).map((x) => x.opportunity_id as string));
}

/** The contract projects made from these tender deals, each with its buy-out packages, read through the Buy-out tab's own summary. */
async function loadProjects(admin: SupabaseClient, tenantId: string, tenderIds: readonly string[]): Promise<DeskProject[]> {
  if (tenderIds.length === 0) return [];
  const found = await readIn(admin, tenantId, "contract_projects", "*", "source_opportunity_id", tenderIds);
  if (!found.ok) return [];
  const projects = found.rows.map(normaliseProject).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, PROJECTS_SHOWN);
  const out: DeskProject[] = [];
  for (const project of projects) {
    try {
      const ctx: BuyoutCtx = { admin, supabase: admin, tenantId, userId: "", role: "member", canEdit: false, project, rfqEdit: false };
      const summary = await buildSummary(ctx);
      if (summary.pending) return [];
      out.push({ id: project.id, name: project.name, createdAt: project.created_at, packages: summary.packages.map((p) => ({ name: p.name, budget: p.budget, best_quote: p.best_quote, committed: p.committed })) });
    } catch (e) {
      console.error("[tenderDesk] buy-out summary failed", (e as Error).message);
    }
  }
  return out;
}
