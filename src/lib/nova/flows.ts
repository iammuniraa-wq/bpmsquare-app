import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { DEFAULT_QUOTE_STATUSES, ROUTES, type QuoteStatusDef, type TenantFeatures } from "@/lib/constants";

/**
 * Nova's "Flows" -- outcome-oriented workflow trackers replacing literal
 * object links (Quotations, Cases, AMC, Invoices) as primary nav. Each
 * carries a real, explainable percent -- never an invented AI confidence
 * number -- computed from the tenant's own configured pipeline stages
 * (quote_statuses) or a plain ratio (collected/invoiced), same
 * "deterministic, shows its own working" rule as Account 360's rating.ts.
 */

export type NovaFlow = {
  id: "pipeline" | "cases" | "contracts" | "cash";
  label: string;
  detail: string;
  percent: number;
  href: string;
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const DAY_MS = 86_400_000;

// Mirrors the CASE_TONE stage order used elsewhere (accounts hub, account
// 360) -- terminal statuses (closed/buyback/scrapped) are excluded since an
// "open" case can't legitimately be in one.
const CASE_STAGE_ORDER = [
  "intake", "inspection", "report_sent", "report_approved",
  "quote_sent", "quote_approved", "in_repair", "qa", "ready",
];

async function pipelineFlow(tenantId: string, quoteStatuses: QuoteStatusDef[]) {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("quotes")
    .select("status, total")
    .eq("tenant_id", tenantId)
    .eq("outcome", "open");
  const quotes = data ?? [];

  const openStages = quoteStatuses.filter((s) => !s.is_closed);
  const stageIndex = new Map(openStages.map((s, i) => [s.value, i]));
  const span = Math.max(1, openStages.length - 1);

  const openValue = quotes.reduce((t, q) => t + (q.total ?? 0), 0);
  const avgProgress = quotes.length
    ? quotes.reduce((t, q) => t + (stageIndex.get(q.status as string) ?? 0) / span, 0) / quotes.length
    : 0;

  return {
    id: "pipeline" as const,
    label: "Close pipeline",
    detail: `${money(openValue)} open · ${quotes.length} deal${quotes.length === 1 ? "" : "s"}`,
    percent: Math.round(avgProgress * 100),
    href: ROUTES.quotations,
  };
}

async function casesFlow(tenantId: string, now: Date) {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("service_cases")
    .select("status, intake_at")
    .eq("tenant_id", tenantId)
    .in("status", CASE_STAGE_ORDER);
  const cases = data ?? [];

  const span = Math.max(1, CASE_STAGE_ORDER.length - 1);
  const avgProgress = cases.length
    ? cases.reduce((t, c) => t + Math.max(0, CASE_STAGE_ORDER.indexOf(c.status as string)) / span, 0) / cases.length
    : 0;
  const breaching = cases.filter((c) => (now.getTime() - new Date(c.intake_at as string).getTime()) / DAY_MS > 30).length;

  return {
    id: "cases" as const,
    label: "Resolve cases",
    detail: `${cases.length} open · ${breaching} breaching SLA`,
    percent: Math.round(avgProgress * 100),
    href: ROUTES.cases,
  };
}

async function contractsFlow(tenantId: string, now: Date) {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("contracts")
    .select("end_date")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  const contracts = data ?? [];

  const daysLeft = (end: string | null) => (end ? Math.floor((new Date(end).getTime() - now.getTime()) / DAY_MS) : Infinity);
  const healthy = contracts.filter((c) => daysLeft(c.end_date as string | null) > 60).length;
  const nearest = contracts
    .map((c) => daysLeft(c.end_date as string | null))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b)[0];

  return {
    id: "contracts" as const,
    label: "Renew contracts",
    detail: `${contracts.length} AMC${nearest !== undefined ? ` · next in ${nearest}d` : ""}`,
    percent: contracts.length ? Math.round((healthy / contracts.length) * 100) : 100,
    href: ROUTES.amc,
  };
}

async function cashFlow(tenantId: string) {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("invoices")
    .select("total, paid_amount, status, due_date")
    .eq("tenant_id", tenantId)
    .not("status", "in", '("cancelled","draft")');
  const invoices = data ?? [];

  const invoiced = invoices.reduce((t, i) => t + (i.total ?? 0), 0);
  const collected = invoices.reduce((t, i) => t + (i.paid_amount ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdueCount = invoices.filter((i) => i.status !== "paid" && i.due_date && (i.due_date as string) < today).length;

  return {
    id: "cash" as const,
    label: "Collect cash",
    detail: `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} out · ${overdueCount} overdue`,
    percent: invoiced > 0 ? Math.round((collected / invoiced) * 100) : 100,
    href: ROUTES.invoices,
  };
}

/**
 * Tenant-scoped (every admin-client query carries its own tenant_id filter,
 * MULTI_TENANT_GUARDRAILS.md), gated on the same feature flags the classic
 * dashboard's own widgets use. One failing source is dropped, not fatal to
 * the rest -- same discipline as getNovaStreamItems().
 */
export async function getNovaFlows(tenantId: string, features: TenantFeatures, quoteStatuses: QuoteStatusDef[]): Promise<NovaFlow[]> {
  const now = new Date();
  const jobs: Promise<NovaFlow | null>[] = [];
  if (features.quotations) jobs.push(pipelineFlow(tenantId, quoteStatuses?.length ? quoteStatuses : DEFAULT_QUOTE_STATUSES));
  if (features.cases) jobs.push(casesFlow(tenantId, now));
  if (features.amc) jobs.push(contractsFlow(tenantId, now));
  if (features.invoices) jobs.push(cashFlow(tenantId));

  const results = await Promise.allSettled(jobs);
  return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}
