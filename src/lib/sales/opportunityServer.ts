import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";
import { opportunityAmount, probabilityFor } from "./opportunity";

// Server-side helpers for opportunities (Piece B). Every query is
// tenant-scoped on the admin client (MULTI_TENANT_GUARDRAILS.md), and every
// one tolerates migration 0120 being pending: a missing table reads as
// "nothing", never as a crash.

export async function loadOpportunity(admin: SupabaseClient, tenantId: string, id: string): Promise<Opportunity | null> {
  const { data, error } = await admin.from("opportunities").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  return data as Opportunity;
}

export async function loadOpportunityLines(admin: SupabaseClient, tenantId: string, id: string): Promise<OpportunityLine[]> {
  const { data, error } = await admin.from("opportunity_lines").select("*").eq("opportunity_id", id).eq("tenant_id", tenantId).order("sl_no");
  if (error) return [];
  return (data ?? []) as OpportunityLine[];
}

export type LinkedQuote = { object: "standard_quote" | "quotation"; id: string; ref: string; status: string; subtotal: number; total: number; created_at: string };

/** The quotes that belong to a deal, newest first, across both quote objects. */
export async function loadLinkedQuotes(admin: SupabaseClient, tenantId: string, id: string): Promise<LinkedQuote[]> {
  const [sq, q] = await Promise.all([
    admin.from("standard_quotes").select("id, ref, status, subtotal, total, created_at").eq("opportunity_id", id).eq("tenant_id", tenantId),
    admin.from("quotes").select("id, ref, status, total, created_at").eq("opportunity_id", id).eq("tenant_id", tenantId),
  ]);
  const out: LinkedQuote[] = [
    ...((sq.error ? [] : sq.data ?? []) as { id: string; ref: string; status: string; subtotal: number; total: number; created_at: string }[])
      .map((r) => ({ object: "standard_quote" as const, id: r.id, ref: r.ref, status: r.status, subtotal: Number(r.subtotal ?? 0), total: Number(r.total ?? 0), created_at: r.created_at })),
    ...((q.error ? [] : q.data ?? []) as { id: string; ref: string; status: string; total: number; created_at: string }[])
      .map((r) => ({ object: "quotation" as const, id: r.id, ref: r.ref, status: r.status, subtotal: Number(r.total ?? 0), total: Number(r.total ?? 0), created_at: r.created_at })),
  ];
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * §4.4: recompute and store amount (latest linked quote's subtotal, else the
 * lines' total) and probability (override, else the stage's hint). Called
 * on line save, quote save/link/unlink, convert and stage change.
 */
export async function refreshOpportunityDerived(
  admin: SupabaseClient, tenantId: string, id: string, stages: OpportunityStageDef[]
): Promise<{ amount: number; probability: number } | null> {
  const opp = await loadOpportunity(admin, tenantId, id);
  if (!opp) return null;
  const [lines, linked] = await Promise.all([loadOpportunityLines(admin, tenantId, id), loadLinkedQuotes(admin, tenantId, id)]);
  // A rejected/expired quote is not what the deal is worth any more.
  const live = linked.filter((q) => !["rejected", "expired"].includes(q.status));
  const amount = opportunityAmount(live.map((q) => ({ created_at: q.created_at, subtotal: q.subtotal })), lines);
  const probability = probabilityFor(stages, opp.stage, opp.probability_override);
  if (amount !== Number(opp.amount) || probability !== opp.probability) {
    await admin.from("opportunities").update({ amount, probability, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
  }
  return { amount, probability };
}

export type OpportunityRow = Opportunity & { account_name: string | null; stage_since: string };

/** The board/list: every deal with its account name and "since" for the
 *  stage. Filters are tenant-scoped column matches. */
export async function listOpportunities(
  admin: SupabaseClient, tenantId: string,
  filters: { stage?: string | null; owner_id?: string | null; account_id?: string | null; outcome?: string | null } = {}
): Promise<OpportunityRow[]> {
  let q = admin.from("opportunities").select("*, accounts(name)").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(500);
  if (filters.stage) q = q.eq("stage", filters.stage);
  if (filters.owner_id) q = q.eq("owner_id", filters.owner_id);
  if (filters.account_id) q = q.eq("account_id", filters.account_id);
  if (filters.outcome) q = q.eq("outcome", filters.outcome);
  const { data, error } = await q;
  if (error) return []; // 0120 pending
  const rows = (data ?? []) as (Opportunity & { accounts?: { name?: string } | { name?: string }[] | null })[];
  const since = await stageSinceMap(admin, tenantId, rows);
  return rows.map((r) => {
    const acc = Array.isArray(r.accounts) ? r.accounts[0] : r.accounts;
    const { accounts: _a, ...rest } = r;
    return { ...(rest as Opportunity), account_name: acc?.name ?? null, stage_since: since.get(r.id) ?? r.created_at };
  });
}

/** When each deal's stage last changed (its latest change-log entry that
 *  touched `stage`), else its creation -- the board's "days in stage". */
export async function stageSinceMap(admin: SupabaseClient, tenantId: string, opps: { id: string; created_at: string }[]): Promise<Map<string, string>> {
  const out = new Map(opps.map((o) => [o.id, o.created_at]));
  if (opps.length === 0) return out;
  const { data } = await admin.from("change_log").select("object_id, changes, created_at")
    .eq("tenant_id", tenantId).eq("object_type", "opportunities").in("object_id", opps.map((o) => o.id))
    .order("created_at", { ascending: false }).limit(1000);
  const seen = new Set<string>();
  for (const row of (data ?? []) as { object_id: string; changes: { field?: string }[]; created_at: string }[]) {
    if (seen.has(row.object_id)) continue;
    if (Array.isArray(row.changes) && row.changes.some((ch) => ch?.field === "stage")) {
      out.set(row.object_id, row.created_at);
      seen.add(row.object_id);
    }
  }
  return out;
}

/** Tenant members for owner/team pickers: id, name, email. Any member may
 *  see colleagues' names -- this is the same list the @-mention and
 *  assignment pickers show. */
export async function listMembersForPicker(admin: SupabaseClient, tenantId: string): Promise<{ user_id: string; name: string | null; email: string | null }[]> {
  const { data: rows } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).limit(200);
  const members = await Promise.all((rows ?? []).map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id as string);
    return { user_id: r.user_id as string, name: (data.user?.user_metadata?.full_name as string | undefined) ?? null, email: data.user?.email ?? null };
  }));
  return members.sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
}
