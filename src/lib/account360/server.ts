import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { LOSS_REASON_LABEL, type Account360Config, type LossReason, type TenantFeatures } from "@/lib/constants";
import type { Account, Contact, Invoice, Quote, ServiceCase } from "@/lib/types";
import { decryptAccount } from "@/lib/encryption";
import { computeRating, type RatingSignals } from "./rating";
import { loadExternalCard } from "./externalSource";
import { resolveCoverageForAccount } from "@/lib/coverage/resolve";
import type {
  Account360Card,
  Account360Payload,
  Account360Row,
  Account360Suggestion,
} from "./types";

/**
 * Assembles the Account 360 payload: every internal card, the health
 * rating, the suggestions, and whatever external sources the tenant has
 * plugged in. One tenant-scoped read per object family, all in parallel.
 *
 * Every query here filters on tenant_id explicitly even though account_id
 * is already proven to belong to the tenant -- this runs on the admin
 * client, where RLS is not a backstop (MULTI_TENANT_GUARDRAILS.md).
 */

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined): number | null =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : null;
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const OPEN_CASE_STATUSES = new Set([
  "intake", "inspection", "report_sent", "report_approved",
  "quote_sent", "quote_approved", "in_repair", "qa", "ready",
]);

/** Ordered, so the drawer's default card order is this file's order. */
const BUILTIN_CARD_IDS = ["pipeline", "revenue", "service", "people", "installed_base", "coverage"] as const;

export async function buildAccount360(
  tenantId: string,
  accountId: string,
  config: Account360Config | undefined
): Promise<Account360Payload | null> {
  const admin = createAdminSupabase();

  const { data: accountRow } = await admin
    .from("accounts").select("*")
    .eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!accountRow) return null;
  // Decrypted because gstin/email are the identifiers an external source is
  // actually keyed on -- ciphertext would silently match nothing.
  const account = decryptAccount(accountRow as Account);

  const { data: tenantFeatureRow } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  const coverageOn = (tenantFeatureRow?.features as TenantFeatures | undefined)?.coverage_model === true;

  const [
    { data: contactRows },
    { data: quoteRows },
    { data: caseRows },
    { data: invoiceRows },
    { data: assetRows },
    { data: contractRows },
    { data: workOrderRows },
  ] = await Promise.all([
    admin.from("contacts").select("id, name, role, created_at")
      .eq("tenant_id", tenantId).eq("account_id", accountId),
    admin.from("quotes").select("id, ref, status, outcome, total, created_at, quote_date, closed_at, loss_reason")
      .eq("tenant_id", tenantId).eq("account_id", accountId).order("created_at", { ascending: false }),
    admin.from("service_cases").select("id, ref, status, type, intake_at, closed_at, equipment_label")
      .eq("tenant_id", tenantId).eq("account_id", accountId).order("intake_at", { ascending: false }),
    admin.from("invoices").select("id, ref, status, total, paid_amount, due_date, created_at, issued_at")
      .eq("tenant_id", tenantId).eq("account_id", accountId).order("created_at", { ascending: false }),
    admin.from("assets").select("id, ref, name, kind, rating, serial, created_at")
      .eq("tenant_id", tenantId).eq("account_id", accountId),
    admin.from("contracts").select("id, ref, status, start_date, end_date, value")
      .eq("tenant_id", tenantId).eq("account_id", accountId),
    admin.from("work_orders").select("id, ref, status, scheduled_for")
      .eq("tenant_id", tenantId).eq("account_id", accountId),
  ]);

  // Contact names/roles are plaintext; phone/email are encrypted and
  // deliberately not read here -- the drawer shows the relationship shape,
  // and the contact record itself remains the place PII is displayed.
  const contacts = (contactRows ?? []) as Pick<Contact, "id" | "name" | "role">[] & { created_at: string }[];
  const quotes = (quoteRows ?? []) as (Pick<Quote, "id" | "ref" | "status" | "outcome" | "total" | "created_at" | "closed_at"> & {
    quote_date: string | null; loss_reason: LossReason | null;
  })[];
  const cases = (caseRows ?? []) as (Pick<ServiceCase, "id" | "ref" | "status" | "type" | "intake_at" | "closed_at" | "equipment_label">)[];
  const invoices = (invoiceRows ?? []) as Pick<Invoice, "id" | "ref" | "status" | "total" | "paid_amount" | "due_date" | "created_at" | "issued_at">[];
  const assets = (assetRows ?? []) as { id: string; ref: string | null; name: string; kind: string; rating: string | null; serial: string | null; created_at: string }[];
  const contracts = (contractRows ?? []) as { id: string; ref: string; status: string; start_date: string | null; end_date: string | null; value: number | null }[];
  const workOrders = (workOrderRows ?? []) as { id: string; ref: string; status: string; scheduled_for: string | null }[];

  // ── Pipeline ────────────────────────────────────────────────────────────
  const openQuotes = quotes.filter((q) => q.outcome === "open");
  const wonQuotes = quotes.filter((q) => q.outcome === "won");
  const decidedQuotes = quotes.filter((q) => q.outcome !== "open");
  const openValue = openQuotes.reduce((t, q) => t + (q.total ?? 0), 0);
  const wonValue = wonQuotes.reduce((t, q) => t + (q.total ?? 0), 0);
  const lostQuotes = quotes.filter((q) => q.outcome === "lost" || q.outcome === "dropped");
  const lossMix = new Map<string, number>();
  for (const q of lostQuotes) if (q.loss_reason) lossMix.set(q.loss_reason, (lossMix.get(q.loss_reason) ?? 0) + 1);
  const topLoss = [...lossMix.entries()].sort((a, b) => b[1] - a[1])[0];

  const winRate = decidedQuotes.length ? Math.round((wonQuotes.length / decidedQuotes.length) * 100) : null;

  const pipelineCard: Account360Card = {
    id: "pipeline",
    title: "Pipeline",
    subtitle: `${quotes.length} quotation${quotes.length === 1 ? "" : "s"} all time`,
    kind: "internal",
    stats: [
      { label: "Open value", value: money(openValue), hint: `${openQuotes.length} open`, tone: openQuotes.length ? "neutral" : undefined },
      { label: "Won value", value: money(wonValue), hint: `${wonQuotes.length} won`, tone: wonQuotes.length ? "good" : undefined },
      {
        label: "Win rate",
        value: winRate === null ? "—" : `${winRate}%`,
        hint: decidedQuotes.length ? `${decidedQuotes.length} decided` : "nothing decided yet",
        tone: winRate === null ? undefined : winRate >= 50 ? "good" : winRate >= 25 ? "warn" : "bad",
      },
      ...(topLoss
        ? [{ label: "Loses most to", value: LOSS_REASON_LABEL[topLoss[0] as LossReason] ?? topLoss[0], hint: `${topLoss[1]} time(s)`, tone: "warn" as const }]
        : []),
    ],
    rows: quotes.slice(0, 5).map((q) => ({
      title: q.ref,
      meta: `${fmtDate(q.quote_date ?? q.created_at)} · ${q.status}`,
      value: money(q.total ?? 0),
      tone: q.outcome === "won" ? ("good" as const) : q.outcome === "lost" || q.outcome === "dropped" ? ("bad" as const) : undefined,
      href: `/quotes/${q.id}`,
    })),
    empty: quotes.length === 0 ? "No quotations yet" : undefined,
  };

  // ── Revenue ─────────────────────────────────────────────────────────────
  const liveInvoices = invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const invoicedTotal = liveInvoices.reduce((t, i) => t + (i.total ?? 0), 0);
  const collected = liveInvoices.reduce((t, i) => t + (i.paid_amount ?? 0), 0);
  const outstanding = Math.max(0, invoicedTotal - collected);
  const overdue = liveInvoices.filter(
    (i) => i.status !== "paid" && i.due_date && new Date(i.due_date).getTime() < Date.now()
  );
  const oldestOverdueDays = overdue.reduce((max, i) => Math.max(max, daysSince(i.due_date) ?? 0), 0);

  const revenueCard: Account360Card = {
    id: "revenue",
    title: "Revenue",
    subtitle: `${liveInvoices.length} issued invoice${liveInvoices.length === 1 ? "" : "s"}`,
    kind: "internal",
    stats: [
      { label: "Invoiced", value: money(invoicedTotal) },
      { label: "Collected", value: money(collected), tone: collected > 0 ? "good" : undefined },
      {
        label: "Outstanding",
        value: money(outstanding),
        hint: overdue.length ? `${overdue.length} overdue, oldest ${oldestOverdueDays}d` : "nothing past due",
        tone: overdue.length ? "bad" : outstanding > 0 ? "warn" : "good",
      },
    ],
    rows: invoices.slice(0, 5).map((i) => ({
      title: i.ref,
      meta: `${i.status} · due ${fmtDate(i.due_date)}`,
      value: money(i.total ?? 0),
      tone: i.status === "paid" ? ("good" as const)
        : i.due_date && new Date(i.due_date).getTime() < Date.now() ? ("bad" as const)
        : undefined,
      href: `/invoices/${i.id}`,
    })),
    empty: invoices.length === 0 ? "Never invoiced" : undefined,
  };

  // ── Service ─────────────────────────────────────────────────────────────
  const openCases = cases.filter((c) => OPEN_CASE_STATUSES.has(c.status));
  const agedCases = openCases.filter((c) => (daysSince(c.intake_at) ?? 0) > 30);
  const closedCases = cases.filter((c) => c.closed_at);
  const avgTurnaround = closedCases.length
    ? Math.round(
        closedCases.reduce((t, c) => t + Math.max(0, (new Date(c.closed_at!).getTime() - new Date(c.intake_at).getTime()) / DAY), 0) /
          closedCases.length
      )
    : null;
  const openWorkOrders = workOrders.filter((w) => w.status !== "completed" && w.status !== "cancelled");

  const serviceCard: Account360Card = {
    id: "service",
    title: "Service",
    subtitle: `${cases.length} case${cases.length === 1 ? "" : "s"} all time`,
    kind: "internal",
    stats: [
      { label: "Open cases", value: String(openCases.length), hint: agedCases.length ? `${agedCases.length} over 30 days` : undefined, tone: agedCases.length ? "bad" : openCases.length ? "neutral" : "good" },
      { label: "Avg turnaround", value: avgTurnaround === null ? "—" : `${avgTurnaround} days`, hint: closedCases.length ? `${closedCases.length} closed` : undefined },
      { label: "Open work orders", value: String(openWorkOrders.length) },
    ],
    rows: cases.slice(0, 5).map((c) => ({
      title: c.ref,
      meta: `${c.equipment_label || c.type} · ${c.status}`,
      value: c.closed_at ? "closed" : `${daysSince(c.intake_at)}d open`,
      tone: c.closed_at ? undefined : (daysSince(c.intake_at) ?? 0) > 30 ? ("bad" as const) : ("neutral" as const),
      href: `/cases/${c.id}`,
    })),
    empty: cases.length === 0 ? "No service history" : undefined,
  };

  // ── People ──────────────────────────────────────────────────────────────
  const peopleCard: Account360Card = {
    id: "people",
    title: "People",
    subtitle: contacts.length === 1 ? "Single-threaded" : `${contacts.length} contacts`,
    kind: "internal",
    rows: contacts.slice(0, 8).map((c) => ({
      title: c.name,
      meta: c.role ?? "—",
      href: `/contacts/${c.id}`,
    })),
    empty: contacts.length === 0 ? "No contacts on file — the account has no human attached to it" : undefined,
  };

  // ── Installed base ──────────────────────────────────────────────────────
  const installedCard: Account360Card = {
    id: "installed_base",
    title: "Installed base",
    subtitle: `${assets.length} asset${assets.length === 1 ? "" : "s"}`,
    kind: "internal",
    rows: assets.slice(0, 8).map((a) => ({
      title: a.name,
      meta: [a.kind, a.rating, a.serial].filter(Boolean).join(" · ") || undefined,
      href: `/assets/${a.id}`,
    })),
    empty: assets.length === 0 ? "No assets recorded" : undefined,
  };

  // ── Coverage (contracts) ────────────────────────────────────────────────
  const activeContracts = contracts.filter((c) => c.status === "active");
  const expiringSoon = activeContracts.filter((c) => {
    const d = c.end_date ? Math.floor((new Date(c.end_date).getTime() - Date.now()) / DAY) : null;
    return d !== null && d >= 0 && d <= 60;
  });
  // Titled "Contracts" (not "Coverage") to avoid colliding with the new
  // Coverage module's own "Sales coverage" card below -- id stays "coverage"
  // unchanged so a tenant's existing hidden_cards/card_order config isn't
  // silently orphaned by a rename.
  const coverageCard: Account360Card = {
    id: "coverage",
    title: "Contracts",
    subtitle: activeContracts.length ? `${activeContracts.length} active contract(s)` : "No active contract",
    kind: "internal",
    rows: contracts.slice(0, 5).map((c) => ({
      title: c.ref,
      meta: `${c.status} · ${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}`,
      value: c.value ? money(c.value) : undefined,
      tone: c.status === "active" ? ("good" as const) : undefined,
    })),
    empty: contracts.length === 0 ? "Not under contract" : undefined,
  };

  const builtins: Record<string, Account360Card> = {
    pipeline: pipelineCard,
    revenue: revenueCard,
    service: serviceCard,
    people: peopleCard,
    installed_base: installedCard,
    coverage: coverageCard,
  };

  // ── Sales coverage (Coverage module) ─────────────────────────────────────
  // Deliberately NOT named "coverage" -- that id is already the contracts
  // card above (built long before the Coverage feature existed). Only
  // computed/registered when the tenant has the module on, so a tenant
  // without it never pays for the extra queries or sees an empty card.
  let activeBuiltinIds: readonly string[] = BUILTIN_CARD_IDS;
  if (coverageOn) {
    const resolved = await resolveCoverageForAccount(tenantId, account);
    const rows: Account360Row[] = [];
    if (resolved.owner) rows.push({ title: resolved.owner.team.name, meta: `Owner · ${resolved.owner.segment.code}`, tone: "good" });
    for (const a of resolved.overlays) rows.push({ title: a.team.name, meta: `Overlay · ${a.segment.code}` });
    for (const a of resolved.services) rows.push({ title: a.team.name, meta: `Service · ${a.segment.code}` });
    builtins.sales_coverage = {
      id: "sales_coverage",
      title: "Sales coverage",
      subtitle: resolved.owner ? `Owned by ${resolved.owner.team.name}` : "No matching owner segment",
      kind: "internal",
      rows,
      empty: rows.length === 0 ? "No segment matches this account yet" : undefined,
    };
    activeBuiltinIds = [...BUILTIN_CARD_IDS, "sales_coverage"];
  }

  // ── Rating ──────────────────────────────────────────────────────────────
  const activityDates = [
    ...quotes.map((q) => q.created_at),
    ...quotes.map((q) => q.closed_at),
    ...cases.map((c) => c.intake_at),
    ...cases.map((c) => c.closed_at),
    ...invoices.map((i) => i.issued_at ?? i.created_at),
    ...workOrders.map((w) => w.scheduled_for),
  ].filter(Boolean) as string[];
  const lastActivity = activityDates.length
    ? activityDates.reduce((a, b) => (new Date(a).getTime() > new Date(b).getTime() ? a : b))
    : null;

  const signals: RatingSignals = {
    daysSinceActivity: daysSince(lastActivity),
    quotesTotal: quotes.length,
    quotesWon: wonQuotes.length,
    quotesDecided: decidedQuotes.length,
    openQuoteValue: openValue,
    invoicedTotal,
    outstanding,
    overdueCount: overdue.length,
    oldestOverdueDays,
    openCases: openCases.length,
    agedCaseCount: agedCases.length,
    contactCount: contacts.length,
  };
  const rating = computeRating(signals);

  // ── Suggestions ─────────────────────────────────────────────────────────
  const suggestions: Account360Suggestion[] = [];
  if (overdue.length > 0) {
    suggestions.push({
      id: "chase-overdue",
      title: `Chase ${money(overdue.reduce((t, i) => t + Math.max(0, (i.total ?? 0) - (i.paid_amount ?? 0)), 0))} overdue`,
      detail: `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} past due, the oldest by ${oldestOverdueDays} days.`,
      urgency: "high",
      href: `/invoices/${overdue[0].id}`,
    });
  }
  const staleOpenQuotes = openQuotes.filter((q) => (daysSince(q.quote_date ?? q.created_at) ?? 0) > 21);
  if (staleOpenQuotes.length > 0) {
    suggestions.push({
      id: "stale-quotes",
      title: `Follow up ${staleOpenQuotes.length} quotation${staleOpenQuotes.length === 1 ? "" : "s"}`,
      detail: `Open with no decision for over three weeks — worth ${money(staleOpenQuotes.reduce((t, q) => t + (q.total ?? 0), 0))}.`,
      urgency: "high",
      href: `/quotes/${staleOpenQuotes[0].id}`,
    });
  }
  if (agedCases.length > 0) {
    suggestions.push({
      id: "aged-cases",
      title: `${agedCases.length} case${agedCases.length === 1 ? "" : "s"} aging past 30 days`,
      detail: "Long-running cases are the usual root of a service complaint that hasn't been made yet.",
      urgency: "medium",
      href: `/cases/${agedCases[0].id}`,
    });
  }
  if (contacts.length <= 1) {
    suggestions.push({
      id: "single-threaded",
      title: contacts.length === 0 ? "Add a contact" : "Add a second contact",
      detail: contacts.length === 0
        ? "Nobody is attached to this account, so nothing can be sent to it."
        : "One contact means one person leaving takes the whole relationship with them.",
      urgency: contacts.length === 0 ? "high" : "medium",
      href: "/contacts",
    });
  }
  if ((signals.daysSinceActivity ?? 0) > 60 && quotes.length > 0) {
    suggestions.push({
      id: "gone-quiet",
      title: `Nothing has happened in ${signals.daysSinceActivity} days`,
      detail: "Past the point where a dormant account usually comes back on its own.",
      urgency: "medium",
    });
  }
  if (expiringSoon.length > 0) {
    suggestions.push({
      id: "contract-renewal",
      title: `${expiringSoon.length} contract${expiringSoon.length === 1 ? "" : "s"} expiring within 60 days`,
      detail: `Earliest ends ${fmtDate(expiringSoon[0].end_date)}. Renewal conversations start before the expiry, not after.`,
      urgency: "medium",
    });
  }
  if (topLoss && topLoss[1] >= 2) {
    suggestions.push({
      id: "loss-pattern",
      title: `Loses on "${LOSS_REASON_LABEL[topLoss[0] as LossReason] ?? topLoss[0]}"`,
      detail: `${topLoss[1]} quotations lost for the same reason — the pattern is about this account, not the market.`,
      urgency: "low",
    });
  }
  if (wonQuotes.length > 0 && invoices.length === 0) {
    suggestions.push({
      id: "won-not-invoiced",
      title: "Won work, nothing invoiced",
      detail: `${wonQuotes.length} won quotation${wonQuotes.length === 1 ? "" : "s"} worth ${money(wonValue)} with no invoice raised against the account.`,
      urgency: "high",
    });
  }

  // ── Card order + tenant's external sources ──────────────────────────────
  const hidden = new Set(config?.hidden_cards ?? []);
  const order = config?.card_order ?? [];
  const orderedIds = [
    ...order.filter((id) => id in builtins),
    ...activeBuiltinIds.filter((id) => !order.includes(id)),
  ];
  const cards: Account360Card[] = orderedIds.filter((id) => !hidden.has(id)).map((id) => builtins[id]);

  const sources = (config?.sources ?? []).filter((s) => s.enabled && !hidden.has(`src:${s.id}`));
  if (sources.length > 0) {
    const tokens = {
      account_id: account.id,
      account_ref: account.ref ?? null,
      account_name: account.name,
      gstin: account.gstin,
      city: account.city,
      email: account.email,
    };
    const external = await Promise.all(sources.slice(0, 6).map((s) => loadExternalCard(s, tokens)));
    cards.push(...external);
  }

  return {
    account: {
      id: account.id,
      name: account.name,
      ref: account.ref ?? null,
      type: account.type,
      city: account.city,
      industry: account.industry,
      since: account.created_at,
    },
    rating,
    suggestions,
    cards,
  };
}
