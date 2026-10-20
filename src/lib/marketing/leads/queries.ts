import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveLeadStage, isLeadStageKey, type LeadStageKey } from "../leadStages";
import { isSchemaPending } from "../pending";
import type { StoredFactors } from "./scorer";

// Reads for the scored-lead screens. Every query is on the admin client with
// the workspace's id; nothing here takes a tenant from a request.

export type ScoredLead = {
  id: string;
  title: string | null;
  source: string | null;
  status: string | null;
  account_id: string;
  account_name: string;
  contact_id: string | null;
  contact_name: string | null;
  score: number | null;
  scored_at: string | null;
  factors: Partial<StoredFactors> | null;
  stage: LeadStageKey;
  owner_user_id: string | null;
  sla_due_at: string | null;
  ready_at: string | null;
  assignment_reason: string | null;
  created_at: string;
};

const LIST_LIMIT = 2000;

type Raw = Record<string, unknown> & {
  accounts?: { name?: string } | { name?: string }[] | null;
  contacts?: { name?: string } | { name?: string }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

async function stageCodes(admin: SupabaseClient, tenantId: string): Promise<Map<string, LeadStageKey>> {
  const { data } = await admin.from("custom_status").select("id, code").eq("tenant_id", tenantId).eq("entity_type", "leads");
  const m = new Map<string, LeadStageKey>();
  for (const r of data ?? []) if (isLeadStageKey(r.code)) m.set(r.id as string, r.code);
  return m;
}

function shape(r: Raw, codes: Map<string, LeadStageKey>): ScoredLead {
  const stored = typeof r.custom_status_id === "string" ? codes.get(r.custom_status_id) ?? null : null;
  return {
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    account_id: r.account_id as string,
    account_name: one(r.accounts)?.name ?? "—",
    contact_id: (r.contact_id as string | null) ?? null,
    contact_name: one(r.contacts)?.name ?? null,
    score: typeof r.score === "number" ? r.score : null,
    scored_at: (r.scored_at as string | null) ?? null,
    factors: (r.score_factors as Partial<StoredFactors> | null) ?? null,
    stage: effectiveLeadStage({ status: r.status as string | null }, stored),
    owner_user_id: (r.owner_user_id as string | null) ?? null,
    sla_due_at: (r.sla_due_at as string | null) ?? null,
    ready_at: (r.ready_at as string | null) ?? null,
    assignment_reason: (r.assignment_reason as string | null) ?? null,
    created_at: r.created_at as string,
  };
}

const COLS = "id, title, source, status, account_id, contact_id, score, score_factors, scored_at, owner_user_id, sla_due_at, ready_at, assignment_reason, custom_status_id, created_at, accounts(name), contacts(name)";
// The same list without the 0160 columns, for a database that has 0140 but not yet 0160.
const COLS_BASE = "id, title, source, status, account_id, contact_id, score, score_factors, scored_at, owner_user_id, sla_due_at, custom_status_id, created_at, accounts(name), contacts(name)";

/** All of the workspace's leads with their scores, best first. `pending` is true while 0140 is not applied. */
export async function listScoredLeads(admin: SupabaseClient, tenantId: string): Promise<{ leads: ScoredLead[]; pending: boolean }> {
  let res = await admin.from("leads").select(COLS).eq("tenant_id", tenantId)
    .order("score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (res.error && isSchemaPending(res.error)) {
    res = await admin.from("leads").select(COLS_BASE).eq("tenant_id", tenantId)
      .order("score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(LIST_LIMIT);
  }
  if (res.error) {
    if (!isSchemaPending(res.error)) console.error(`[leads] list failed: ${res.error.message}`);
    return { leads: [], pending: isSchemaPending(res.error) };
  }
  const codes = await stageCodes(admin, tenantId);
  return { leads: ((res.data ?? []) as unknown as Raw[]).map((r) => shape(r, codes)), pending: false };
}

export async function getScoredLead(admin: SupabaseClient, tenantId: string, id: string): Promise<{ lead: ScoredLead | null; pending: boolean }> {
  let res = await admin.from("leads").select(COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (res.error && isSchemaPending(res.error)) res = await admin.from("leads").select(COLS_BASE).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (res.error) return { lead: null, pending: isSchemaPending(res.error) };
  if (!res.data) return { lead: null, pending: false };
  return { lead: shape(res.data as unknown as Raw, await stageCodes(admin, tenantId)), pending: false };
}

export type TimelineItem = { id: string; name: string; occurred_at: string; payload: Record<string, unknown> | null };

/** What this lead's people did, newest first: their own events, plus the lead's own milestones. */
export async function loadLeadTimeline(admin: SupabaseClient, tenantId: string, lead: Pick<ScoredLead, "id" | "account_id" | "contact_id">, limit = 40): Promise<TimelineItem[]> {
  const base = () => admin.from("domain_event").select("id, name, occurred_at, payload").eq("tenant_id", tenantId).order("occurred_at", { ascending: false }).limit(limit);
  const people = lead.contact_id ? base().eq("contact_id", lead.contact_id) : base().eq("account_id", lead.account_id);
  const own = base().eq("lead_id", lead.id);
  const [a, b] = await Promise.all([people, own]);
  const merged = new Map<string, TimelineItem>();
  for (const r of [...((a.data ?? []) as TimelineItem[]), ...((b.data ?? []) as TimelineItem[])]) merged.set(r.id, r);
  return [...merged.values()].sort((x, y) => y.occurred_at.localeCompare(x.occurred_at)).slice(0, limit);
}

/** The best (highest-scoring) active lead of an account, for Account 360 and target groups. */
export async function bestLeadsByAccount(admin: SupabaseClient, tenantId: string, accountIds?: string[]): Promise<Map<string, ScoredLead>> {
  let q = admin.from("leads").select(COLS_BASE).eq("tenant_id", tenantId).not("score", "is", null).limit(5000);
  if (accountIds && accountIds.length > 0) q = q.in("account_id", accountIds);
  const { data, error } = await q;
  if (error) return new Map();
  const codes = await stageCodes(admin, tenantId);
  const best = new Map<string, ScoredLead>();
  for (const r of (data ?? []) as unknown as Raw[]) {
    const lead = shape(r, codes);
    // A lead that has ended (customer, not a fit) is not "the lead to act on".
    if (lead.stage === "customer" || lead.stage === "not_fit") continue;
    const cur = best.get(lead.account_id);
    if (!cur || (lead.score ?? -1) > (cur.score ?? -1)) best.set(lead.account_id, lead);
  }
  return best;
}
