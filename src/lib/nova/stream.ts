import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { ROUTES } from "@/lib/constants";

/**
 * Nova Stream's action items -- REAL computed signals, not the design
 * prototype's fictional AI sentiment/velocity numbers. Each item carries an
 * explainable score (see computeScore below) mirroring the Account 360
 * rubric pattern (src/lib/account360/rating.ts): deterministic, no AI call,
 * the "why" is always visible next to the number.
 *
 * "Stale leads" was considered and dropped -- Lead only has created_at, no
 * last-activity timestamp, so no honest staleness signal exists yet.
 */

export type NovaStreamKind = "quote_pending" | "contract_lapsing" | "product_unquoted" | "wfm_approval";

export type NovaStreamItem = {
  id: string;
  kind: NovaStreamKind;
  score: number;
  title: string;
  detail: string;
  href: string;
  accent: "orange" | "pink" | "purple" | "teal";
};

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY_MS);

// Quotes sent and awaiting a response -- older = more urgent, capped so a
// years-old abandoned quote doesn't dominate the stream forever.
async function getPendingQuoteItems(admin: SupabaseClient, tenantId: string, now: Date): Promise<NovaStreamItem[]> {
  const { data } = await admin
    .from("quotes")
    .select("id, ref, total, submitted_at, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "sent")
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: true })
    .limit(50);

  return (data ?? [])
    .map((r): NovaStreamItem | null => {
      const submittedAt = r.submitted_at as string;
      const days = daysBetween(now, new Date(submittedAt));
      if (days < 3) return null;
      const accountName =
        (Array.isArray(r.accounts) ? r.accounts[0]?.name : (r.accounts as { name?: string } | null)?.name) ?? "—";
      const score = Math.min(95, 40 + days * 2);
      return {
        id: `quote_pending:${r.id as string}`,
        kind: "quote_pending",
        score,
        title: `${accountName} hasn't responded to ${r.ref as string}`,
        detail: `Sent ${days} day${days === 1 ? "" : "s"} ago · ₹${Number(r.total ?? 0).toLocaleString("en-IN")}`,
        href: ROUTES.quotation(r.id as string),
        accent: "orange",
      };
    })
    .filter((x): x is NovaStreamItem => x !== null);
}

// AMC contracts lapsing within 30 days -- sooner = more urgent.
async function getLapsingContractItems(admin: SupabaseClient, tenantId: string, now: Date): Promise<NovaStreamItem[]> {
  const cutoff = new Date(now.getTime() + 30 * DAY_MS).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const { data } = await admin
    .from("contracts")
    .select("id, ref, end_date, value, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .not("end_date", "is", null)
    .lte("end_date", cutoff)
    .order("end_date", { ascending: true })
    .limit(50);

  return (data ?? [])
    .filter((r) => (r.end_date as string) >= today)
    .map((r) => {
      const daysLeft = daysBetween(new Date(r.end_date as string), now);
      const accountName =
        (Array.isArray(r.accounts) ? r.accounts[0]?.name : (r.accounts as { name?: string } | null)?.name) ?? "—";
      const score = Math.min(95, 90 - daysLeft * 2);
      return {
        id: `contract_lapsing:${r.id as string}`,
        kind: "contract_lapsing" as const,
        score: Math.max(20, score),
        title: `${accountName}'s AMC ${r.ref as string} lapses in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        detail: r.value ? `₹${Number(r.value).toLocaleString("en-IN")}/yr` : "Renewal due",
        href: ROUTES.amc,
        accent: "pink" as const,
      };
    });
}

// Active products that have never appeared on a quote line -- a static
// opportunity list, so scored flat and capped low in the stream (never the
// most urgent thing, but worth surfacing occasionally).
async function getUnquotedProductItems(admin: SupabaseClient, tenantId: string): Promise<NovaStreamItem[]> {
  const { data: lines } = await admin
    .from("quote_lines")
    .select("product_id")
    .eq("tenant_id", tenantId)
    .not("product_id", "is", null);
  const quotedIds = new Set((lines ?? []).map((l) => l.product_id as string));

  const { data: products } = await admin
    .from("products")
    .select("id, name, sku")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .limit(200);

  return (products ?? [])
    .filter((p) => !quotedIds.has(p.id as string))
    .slice(0, 5)
    .map((p) => ({
      id: `product_unquoted:${p.id as string}`,
      kind: "product_unquoted" as const,
      score: 35,
      title: `${p.name as string} has never been quoted`,
      detail: p.sku ? `SKU ${p.sku as string}` : "No quote history",
      href: ROUTES.product(p.id as string),
      accent: "teal" as const,
    }));
}

// WFM approvals pending THIS user's decision -- only if they're a
// supervisor; a plain employee has nothing to approve. Reuses the exact
// scope resolution the approvals API and queue pages already trust.
async function getWfmApprovalItems(admin: SupabaseClient, tenantId: string): Promise<NovaStreamItem[]> {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch {
    return [];
  }
  if (ctx.tenantId !== tenantId) return [];

  const scope = await resolveWfmScope(ctx);
  const employeeIds = scope.employeeIds ?? [];

  async function countPending(table: "wfm_correction_requests" | "wfm_leave_requests" | "wfm_ot_sessions"): Promise<number> {
    const base = admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending");
    const { count } = await (scope.unrestricted ? base : base.in("employee_id", employeeIds));
    return count ?? 0;
  }

  const [corrCount, leaveCount, otCount] = await Promise.all([
    countPending("wfm_correction_requests"),
    countPending("wfm_leave_requests"),
    countPending("wfm_ot_sessions"),
  ]);

  const items: NovaStreamItem[] = [];
  if (corrCount > 0) {
    items.push({
      id: "wfm_approval:corrections",
      kind: "wfm_approval",
      score: Math.min(90, 45 + corrCount * 5),
      title: `${corrCount} attendance correction${corrCount === 1 ? "" : "s"} awaiting your approval`,
      detail: "Corrections queue",
      href: ROUTES.wfmCorrections,
      accent: "purple",
    });
  }
  if (leaveCount > 0) {
    items.push({
      id: "wfm_approval:leave",
      kind: "wfm_approval",
      score: Math.min(90, 45 + leaveCount * 5),
      title: `${leaveCount} leave request${leaveCount === 1 ? "" : "s"} awaiting your approval`,
      detail: "Leave & Holidays queue",
      href: ROUTES.wfmLeave,
      accent: "purple",
    });
  }
  if (otCount > 0) {
    items.push({
      id: "wfm_approval:overtime",
      kind: "wfm_approval",
      score: Math.min(90, 45 + otCount * 5),
      title: `${otCount} overtime session${otCount === 1 ? "" : "s"} awaiting your approval`,
      detail: "Overtime queue",
      href: ROUTES.wfmCorrections,
      accent: "purple",
    });
  }
  return items;
}

export type NovaWinItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  date: string;
};

// Recent good news -- quotes won and cases closed in the last 14 days,
// tenant-wide. Balances the action stream's all-urgent framing with real
// positive signal, same tenant-scoping discipline as every signal above.
async function getRecentWins(admin: SupabaseClient, tenantId: string, now: Date): Promise<NovaWinItem[]> {
  const cutoff = new Date(now.getTime() - 14 * DAY_MS).toISOString();

  const [quotesR, casesR] = await Promise.allSettled([
    admin
      .from("quotes")
      .select("id, ref, total, closed_at, accounts(name)")
      .eq("tenant_id", tenantId)
      .eq("outcome", "won")
      .not("closed_at", "is", null)
      .gte("closed_at", cutoff)
      .order("closed_at", { ascending: false })
      .limit(5),
    admin
      .from("service_cases")
      .select("id, ref, closed_at, equipment_label, accounts(name)")
      .eq("tenant_id", tenantId)
      .eq("status", "closed")
      .not("closed_at", "is", null)
      .gte("closed_at", cutoff)
      .order("closed_at", { ascending: false })
      .limit(5),
  ]);

  const wins: NovaWinItem[] = [];
  if (quotesR.status === "fulfilled") {
    for (const q of quotesR.value.data ?? []) {
      const accountName = (Array.isArray(q.accounts) ? q.accounts[0]?.name : (q.accounts as { name?: string } | null)?.name) ?? "—";
      wins.push({
        id: `win:quote:${q.id as string}`,
        title: `${q.ref as string} won`,
        detail: `${accountName} · ₹${Number(q.total ?? 0).toLocaleString("en-IN")}`,
        href: ROUTES.quotation(q.id as string),
        date: q.closed_at as string,
      });
    }
  }
  if (casesR.status === "fulfilled") {
    for (const cs of casesR.value.data ?? []) {
      const accountName = (Array.isArray(cs.accounts) ? cs.accounts[0]?.name : (cs.accounts as { name?: string } | null)?.name) ?? "—";
      wins.push({
        id: `win:case:${cs.id as string}`,
        title: `${cs.ref as string} closed`,
        detail: `${accountName}${cs.equipment_label ? " · " + (cs.equipment_label as string) : ""}`,
        href: ROUTES.case(cs.id as string),
        date: cs.closed_at as string,
      });
    }
  }

  return wins.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4);
}

/**
 * Tenant-scoped (MULTI_TENANT_GUARDRAILS.md: every createAdminSupabase()
 * query here carries its own .eq("tenant_id", tenantId)), sorted highest
 * score first. Any one signal source failing (e.g. a table not yet
 * migrated) must not take the others down with it.
 */
export async function getNovaStreamItems(tenantId: string): Promise<NovaStreamItem[]> {
  const admin = createAdminSupabase();
  const now = new Date();

  const results = await Promise.allSettled([
    getPendingQuoteItems(admin, tenantId, now),
    getLapsingContractItems(admin, tenantId, now),
    getUnquotedProductItems(admin, tenantId),
    getWfmApprovalItems(admin, tenantId),
  ]);

  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return items.sort((a, b) => b.score - a.score);
}

export async function getNovaRecentWins(tenantId: string): Promise<NovaWinItem[]> {
  const admin = createAdminSupabase();
  return getRecentWins(admin, tenantId, new Date());
}
