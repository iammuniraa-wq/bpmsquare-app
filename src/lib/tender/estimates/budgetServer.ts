import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateBudgetInput } from "@/lib/contractProjects/fromTender";
import type { BudgetEstimate, BudgetLink } from "./budgetParts";
import { isLinkStale, isUuid, type Basis, type EstLine } from "./rules";

// What the contract project budget reads from the estimates that priced a tender's BOQ (slice 3c-1, "Budget after award"). Standalone
// on purpose: the project creation path imports only this and the pure rules. Every query is tenant-scoped, an estimate must belong to
// THIS deal, and a missing table (0227 pending) reads as "no links" so a workspace that never used estimates in a tender gets exactly
// the budget it got before.

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function loadEstimateBudgetInputs(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<EstimateBudgetInput> {
  const out = new Map<string, { links: { link: BudgetLink; estimate: BudgetEstimate | null }[] }>();
  if (!isUuid(opportunityId)) return out;
  const lk = await admin.from("tender_boq_estimate_links")
    .select("boq_line_id, estimate_id, output, basis, share_pct, applied_at, estimate_updated_at").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).limit(10000);
  if (lk.error || !lk.data || lk.data.length === 0) return out;
  const links = lk.data as { boq_line_id: string; estimate_id: string; output: string; basis: string; share_pct: number | string; applied_at: string | null; estimate_updated_at: string | null }[];

  const boq = await admin.from("tender_boq_lines").select("id, line_id").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).limit(5000);
  const dealLineOfBoq = new Map(((boq.error ? [] : boq.data ?? []) as { id: string; line_id: string | null }[]).filter((b) => b.line_id).map((b) => [b.id, b.line_id!]));

  const estimateIds = [...new Set(links.map((l) => l.estimate_id))];
  const heads = new Map<string, { ref: string; updated_at: string }>();
  for (let i = 0; i < estimateIds.length; i += 100) {
    const e = await admin.from("estimates").select("id, ref, name, updated_at").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).in("id", estimateIds.slice(i, i + 100));
    for (const r of (e.error ? [] : e.data ?? []) as { id: string; ref: string | null; name: string; updated_at: string }[]) heads.set(r.id, { ref: r.ref ?? r.name, updated_at: r.updated_at });
  }
  const lines = new Map<string, EstLine[]>([...heads.keys()].map((k) => [k, []]));
  for (let i = 0; i < estimateIds.length; i += 50) {
    for (let from = 0; ; from += 1000) {
      const l = await admin.from("estimate_lines")
        .select("id, estimate_id, code, description, uom, qty, waste_pct, unit_cost, cost_total, component, wbs_code, product_id, custom_data, updated_at, sort_order")
        .eq("tenant_id", tenantId).in("estimate_id", estimateIds.slice(i, i + 50)).order("sort_order").range(from, from + 999);
      if (l.error || !l.data || l.data.length === 0) break;
      for (const r of l.data as Record<string, unknown>[]) {
        lines.get(String(r.estimate_id))?.push({
          id: String(r.id), code: (r.code as string | null) ?? null, description: String(r.description ?? ""), uom: (r.uom as string | null) ?? null,
          qty: Number(r.qty ?? 0), waste_pct: Number(r.waste_pct ?? 0), unit_cost: num(r.unit_cost), cost_total: num(r.cost_total),
          component: (r.component as string | null) ?? null, wbs_code: (r.wbs_code as string | null) ?? null, product_id: (r.product_id as string | null) ?? null,
          custom_data: r.custom_data && typeof r.custom_data === "object" ? (r.custom_data as Record<string, unknown>) : null,
          updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
        });
      }
      if (l.data.length < 1000) break;
    }
  }

  for (const l of links) {
    const dealLine = dealLineOfBoq.get(l.boq_line_id);
    if (!dealLine) continue;
    const head = heads.get(l.estimate_id);
    const entry = out.get(dealLine) ?? { links: [] };
    entry.links.push({
      link: {
        output: l.output, basis: l.basis === "per_unit" ? "per_unit" as Basis : "total" as Basis, share_pct: Number(l.share_pct),
        estimate_ref: head?.ref ?? "Estimate", changed_since: !!head && isLinkStale({ applied_at: l.applied_at, estimate_updated_at: l.estimate_updated_at }, head.updated_at),
      },
      estimate: head ? { ref: head.ref, lines: lines.get(l.estimate_id) ?? [] } : null,
    });
    out.set(dealLine, entry);
  }
  return out;
}
