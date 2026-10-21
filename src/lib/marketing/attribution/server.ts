import "server-only";
import type { ModuleCtx, ModuleSpec } from "@/lib/marketing/moduleAccess";
import { isSchemaPending } from "@/lib/marketing/pending";
import { ASSET_TYPES, MODELS, MODES, type AssetType, type Mode, type Model } from "./models";

// The report's reads. Members read attribution_results through the SESSION client (select-only RLS is the real
// backstop) and every query also names the tenant. Asset names are looked up in this tenant only.

export const ATTRIBUTION_SPEC: ModuleSpec = { flag: "marketing_attribution", workcenter: "marketing_attribution", label: "Revenue by source", migrations: "0190 to 0192" };

export type ReportRow = {
  assetId: string;
  name: string;
  touches: number;
  people: number;
  sourcedDeals: number;
  sourcedOpenValue: number;
  sourcedWonDeals: number;
  sourcedWonValue: number;
  sourcedPaidValue: number;
  influencedDeals: number;
  influencedWonDeals: number;
  influencedWonValue: number;
};

export type Report = {
  rows: ReportRow[];
  computedAt: string | null;
  dealsConsidered: number;
  lastError: string | null;
  missing: boolean;
};

export type ReportParams = { by: AssetType; model: Model; mode: Mode };

export function parseReportParams(sp: URLSearchParams): ReportParams {
  const by = sp.get("by");
  const model = sp.get("model");
  const mode = sp.get("mode");
  return {
    by: (ASSET_TYPES as readonly string[]).includes(by ?? "") ? (by as AssetType) : "campaign",
    model: (MODELS as readonly string[]).includes(model ?? "") ? (model as Model) : "first",
    mode: (MODES as readonly string[]).includes(mode ?? "") ? (mode as Mode) : "engaged",
  };
}

/** Where the name of each kind of asset lives. A missing table (a module not installed yet) just means "no name". */
const NAME_SOURCE: Record<AssetType, { table: string; column: string }> = {
  campaign: { table: "marketing_campaigns", column: "name" },
  newsletter: { table: "newsletters", column: "name" },
  form: { table: "forms", column: "name" },
  journey: { table: "journeys", column: "name" },
  whatsapp: { table: "whatsapp_templates", column: "name" },
  event: { table: "marketing_events", column: "name" },
};

export async function loadReport(ctx: ModuleCtx, p: ReportParams): Promise<Report> {
  const { data, error } = await ctx.supabase.from("attribution_results").select("*")
    .eq("tenant_id", ctx.tenantId).eq("asset_type", p.by).eq("model", p.model).eq("mode", p.mode).limit(500);
  if (error) return { rows: [], computedAt: null, dealsConsidered: 0, lastError: null, missing: isSchemaPending(error) };
  const raw = (data ?? []) as Record<string, number | string>[];

  const names = new Map<string, string>();
  const ids = raw.map((r) => r.asset_id as string);
  if (ids.length) {
    const src = NAME_SOURCE[p.by];
    const n = await ctx.supabase.from(src.table).select(`id, ${src.column}`).eq("tenant_id", ctx.tenantId).in("id", ids);
    if (!n.error) for (const r of (n.data ?? []) as unknown as Record<string, string>[]) names.set(r.id, r[src.column]);
  }

  const num = (r: Record<string, number | string>, k: string) => Number(r[k] ?? 0);
  const rows: ReportRow[] = raw.map((r) => ({
    assetId: r.asset_id as string, name: names.get(r.asset_id as string) ?? "Removed or unnamed",
    touches: num(r, "touches"), people: num(r, "people"),
    sourcedDeals: num(r, "sourced_deals"), sourcedOpenValue: num(r, "sourced_open_value"), sourcedWonDeals: num(r, "sourced_won_deals"),
    sourcedWonValue: num(r, "sourced_won_value"), sourcedPaidValue: num(r, "sourced_paid_value"),
    influencedDeals: num(r, "influenced_deals"), influencedWonDeals: num(r, "influenced_won_deals"), influencedWonValue: num(r, "influenced_won_value"),
  })).sort((a, b) => b.sourcedWonValue - a.sourcedWonValue || b.sourcedDeals - a.sourcedDeals || b.influencedDeals - a.influencedDeals || b.touches - a.touches);

  const computedAt = raw.map((r) => String(r.computed_at ?? "")).sort().pop() || null;
  const { count } = await ctx.supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).neq("outcome", "dropped");
  return { rows, computedAt, dealsConsidered: count ?? 0, lastError: null, missing: false };
}
