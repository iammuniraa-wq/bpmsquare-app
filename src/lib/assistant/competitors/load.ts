import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import { readAllPages } from "@/lib/pagedRead";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { loadTender, isMissingSchema } from "@/lib/tender/server";
import { listCompetitors } from "@/lib/tender/competitors/server";
import { sameCompany } from "@/lib/tender/competitors/rules";
import { currentSnapshot } from "@/lib/tender/bids/server";
import { currentCostSummary, loadBidCostTotals } from "@/lib/tender/bids/costServer";
import { isUuid } from "../objects";
import type { AnalysisInput, CompetitorInput, PastTender } from "./compute";

// Reads what the analysis needs from this workspace and nothing else. Every query carries the workspace the caller's session
// resolved (the model never supplies one) and goes through the service-role client with an explicit tenant filter, because the
// bid cost table has no member policy at all. A table or column that a pending migration has not created reads as "no data", never
// as a crash.

export type DealMoney = { price: number | null; cost: number | null; costedAmount: number; costedLines: number; totalLines: number };

export type LoadDeps = {
  /** The deal's lines priced as they stand, and their recorded cost. Replaced in tests. */
  money?: (admin: SupabaseClient, tenantId: string, dealId: string, costVisible: boolean) => Promise<DealMoney>;
};

export async function dealMoney(admin: SupabaseClient, tenantId: string, dealId: string, costVisible: boolean): Promise<DealMoney> {
  try {
    const snap = await currentSnapshot(admin, tenantId, dealId);
    const price = snap.total > 0 ? snap.total : null;
    if (!costVisible || price === null) return { price, cost: null, costedAmount: 0, costedLines: 0, totalLines: snap.line_count };
    const c = await currentCostSummary(admin, tenantId, dealId, snap);
    return { price, cost: c.cost > 0 ? c.cost : null, costedAmount: c.costedAmount, costedLines: c.costedLines, totalLines: c.pricedLines };
  } catch (e) {
    console.error("Competitor analysis could not read the deal's price and cost:", e);
    return { price: null, cost: null, costedAmount: 0, costedLines: 0, totalLines: 0 };
  }
}

const REF = /^[A-Za-z]{2,8}-\d{1,8}$/;

export type Resolved = { ok: true; id: string } | { ok: false; message: string };

const STAGE_OUTCOME: Record<string, PastTender["outcome"]> = { awarded: "won", bid_lost: "lost", no_bid: "dropped" };

/** won / lost / dropped / open, from the deal's outcome and, for a row saved without one, its stage. */
export function outcomeOf(row: { outcome?: unknown; stage?: unknown }): PastTender["outcome"] {
  const o = row.outcome;
  if (o === "won" || o === "lost" || o === "dropped") return o;
  return typeof row.stage === "string" && STAGE_OUTCOME[row.stage] ? STAGE_OUTCOME[row.stage] : "open";
}

const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** The tender the person means: a reference or id they named, else the deal that is open, else the one deal a competitor name points to. */
export async function resolveDeal(admin: SupabaseClient, tenantId: string, ask: { deal: string | null; competitor: string | null }, openDealId: string | null): Promise<Resolved> {
  let id: string | null = null;
  if (ask.deal) {
    const d = ask.deal.trim();
    if (isUuid(d.toLowerCase())) id = d.toLowerCase();
    else if (REF.test(d)) {
      const { data } = await admin.from("opportunities").select("id").eq("tenant_id", tenantId).ilike("ref", d).limit(2);
      const hit = (data ?? []) as { id: string }[];
      if (hit.length !== 1) return { ok: false, message: `No tender deal ${d.toUpperCase()} was found in this workspace.` };
      id = hit[0].id;
    } else return { ok: false, message: "Give the tender's reference, for example OPP-0034, or open the tender first." };
  } else if (openDealId) id = openDealId;
  else if (ask.competitor) {
    const { data } = await admin.from("opportunity_competitors").select("opportunity_id, name, status").eq("tenant_id", tenantId).ilike("name", `%${escapeLike(ask.competitor)}%`).limit(200);
    const ids = [...new Set(((data ?? []) as { opportunity_id: string; name: string; status?: string }[])
      .filter((r) => sameCompany(r.name, ask.competitor!) && r.status !== "rejected" && r.status !== "proposed").map((r) => r.opportunity_id))];
    if (ids.length === 0) return { ok: false, message: `${ask.competitor} is not recorded on any tender yet. Ask which tender, or offer to add it with propose_competitor.` };
    const { data: opps } = await admin.from("opportunities").select("id, ref, outcome, stage").eq("tenant_id", tenantId).in("id", ids.slice(0, 100));
    const rows = (opps ?? []) as { id: string; ref: string | null; outcome?: string; stage?: string }[];
    const open = rows.filter((r) => outcomeOf(r) === "open");
    const pick = open.length === 1 ? open : rows.length === 1 ? rows : null;
    if (!pick) return { ok: false, message: `${ask.competitor} is on several tenders (${(open.length ? open : rows).slice(0, 5).map((r) => r.ref ?? "no reference").join(", ")}). Ask which one.` };
    id = pick[0].id;
  } else return { ok: false, message: "Say which tender (for example OPP-0034) or open one first." };

  const opp = await loadOpportunity(admin, tenantId, id);
  const tender = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !tender) return { ok: false, message: "That is not a tender deal in this workspace." };
  return { ok: true, id };
}

type TenderHead = { opportunity_id: string; award_value?: unknown; winning_bidder?: unknown };

async function pastTenders(admin: SupabaseClient, tenantId: string, exceptId: string, costVisible: boolean): Promise<PastTender[]> {
  const read = (cols: string) => readAllPages<TenderHead>((lo, hi) =>
    admin.from("opportunity_tenders").select(cols).eq("tenant_id", tenantId).order("opportunity_id", { ascending: true }).range(lo, hi), { maxRows: 3000 });
  let heads = await read("opportunity_id, award_value, winning_bidder");
  if (heads.error && isMissingSchema(heads.error)) heads = await read("opportunity_id");
  const tenders = (heads.data ?? []).filter((t) => t.opportunity_id !== exceptId);
  if (tenders.length === 0) return [];
  const ids = tenders.map((t) => t.opportunity_id);

  const oppRows = new Map<string, { outcome?: unknown; stage?: unknown; currency?: string | null }>();
  for (const part of chunks(ids, 100)) {
    const { data } = await admin.from("opportunities").select("id, outcome, stage, currency").eq("tenant_id", tenantId).in("id", part);
    for (const r of (data ?? []) as { id: string; outcome?: unknown; stage?: unknown; currency?: string | null }[]) oppRows.set(r.id, r);
  }

  const wanted = new Set(ids);
  const readComp = (cols: string) => readAllPages<{ opportunity_id: string; name: string; status?: string }>((lo, hi) =>
    admin.from("opportunity_competitors").select(cols).eq("tenant_id", tenantId).order("id", { ascending: true }).range(lo, hi), { maxRows: 20_000 });
  let comp = await readComp("opportunity_id, name, status");
  if (comp.error && isMissingSchema(comp.error)) comp = await readComp("opportunity_id, name");
  const listed = new Map<string, string[]>();
  for (const r of comp.data ?? []) {
    if (!wanted.has(r.opportunity_id) || r.status === "rejected" || r.status === "proposed" || !r.name) continue;
    listed.set(r.opportunity_id, [...(listed.get(r.opportunity_id) ?? []), r.name]);
  }

  const latest = new Map<string, { version: number; total: number | null }>();
  for (const part of chunks(ids, 100)) {
    const { data } = await admin.from("tender_bid_versions").select("opportunity_id, version_no, total").eq("tenant_id", tenantId).in("opportunity_id", part).limit(1000);
    for (const r of (data ?? []) as { opportunity_id: string; version_no: number; total: unknown }[]) {
      const v = Number(r.version_no);
      const had = latest.get(r.opportunity_id);
      if (!had || v > had.version) latest.set(r.opportunity_id, { version: v, total: num(r.total) });
    }
  }
  const costTotals: Awaited<ReturnType<typeof loadBidCostTotals>> = costVisible ? await loadBidCostTotals(admin, tenantId, ids) : new Map();
  const costOf = (id: string) => {
    const v = latest.get(id)?.version;
    return v === undefined ? undefined : costTotals.get(`${id}:${v}`);
  };

  return tenders.filter((t) => oppRows.has(t.opportunity_id)).map((t): PastTender => {
    const o = oppRows.get(t.opportunity_id)!;
    const winner = typeof t.winning_bidder === "string" && t.winning_bidder.trim() ? t.winning_bidder.trim() : null;
    return {
      outcome: outcomeOf(o),
      currency: o.currency ?? null,
      ourBid: latest.get(t.opportunity_id)?.total ?? null,
      ourCost: costOf(t.opportunity_id)?.cost ?? null,
      ourCostedAmount: costOf(t.opportunity_id)?.costedAmount ?? null,
      awardValue: num(t.award_value),
      winner,
      competitors: listed.get(t.opportunity_id) ?? [],
    };
  });
}

export async function loadAnalysisInput(
  admin: SupabaseClient, tenantId: string, dealId: string,
  o: { costVisible: boolean; focus: string | null; now: Date; deps?: LoadDeps },
): Promise<{ ok: true; input: AnalysisInput } | { ok: false; message: string }> {
  const opp = await loadOpportunity(admin, tenantId, dealId);
  const tender = opp ? await loadTender(admin, tenantId, dealId) : null;
  if (!opp || !tender) return { ok: false, message: "That is not a tender deal in this workspace." };

  const money = await (o.deps?.money ?? dealMoney)(admin, tenantId, dealId, o.costVisible);
  const { rows, pending } = await listCompetitors(admin, tenantId, dealId);
  const here = pending ? [] : rows;
  const competitors: CompetitorInput[] = here.filter((c) => c.status === "accepted").map((c) => ({
    name: c.name, country: c.country, expectedPrice: c.expected_price,
    evidence: c.evidence ? {
      facts: c.evidence.facts.map((f) => ({ text: f.text, kind: f.kind, source_url: f.source_url })),
      price: c.evidence.price ? { text: c.evidence.price.text, source_url: c.evidence.price.source_url } : null,
      wins: c.evidence.wins ? { text: c.evidence.wins.text, source_url: c.evidence.wins.source_url } : null,
      researchedAt: c.evidence.researched_at || null,
    } : null,
  }));

  return {
    ok: true,
    input: {
      deal: {
        ref: opp.ref ?? "this tender", title: opp.title, href: ROUTES.pipelineDetail(dealId), closingAt: tender.closing_at,
        currency: opp.currency ?? null, price: money.price, cost: money.cost, costedAmount: money.costedAmount, costedLines: money.costedLines, totalLines: money.totalLines,
        state: outcomeOf(opp),
      },
      competitors,
      past: await pastTenders(admin, tenantId, dealId, o.costVisible),
      proposed: here.filter((c) => c.status === "proposed").length,
      focus: o.focus, costVisible: o.costVisible, now: o.now,
    },
  };
}
