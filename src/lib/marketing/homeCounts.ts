import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";

/**
 * The small numbers on the Marketing and Intelligence Overview screens. Every query is scoped to the caller's tenant and
 * tolerant: a table that is not there yet (its SQL is pending) or any error gives null, and the tile then shows no number
 * instead of failing the page.
 */
type Where = { column: string; op: "eq" | "in" | "gte"; value: string | number | string[] };

export async function countRows(tenantId: string, table: string, where: Where[] = []): Promise<number | null> {
  try {
    let q = createAdminSupabase().from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    for (const w of where) {
      if (w.op === "eq") q = q.eq(w.column, w.value as string);
      else if (w.op === "gte") q = q.gte(w.column, w.value as number);
      else q = q.in(w.column, w.value as string[]);
    }
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export type MarketingHomeCounts = { liveJourneys: number | null; liveForms: number | null; events: number | null; whatsappTemplates: number | null };
export type IntelligenceHomeCounts = { inMarket: number | null; scoredLeads: number | null; abmPrograms: number | null };

export async function marketingHomeCounts(tenantId: string, f: Record<string, boolean | undefined>): Promise<MarketingHomeCounts> {
  const [liveJourneys, liveForms, events, whatsappTemplates] = await Promise.all([
    f.journeys ? countRows(tenantId, "journeys", [{ column: "status", op: "eq", value: "live" }]) : null,
    f.marketing_forms ? countRows(tenantId, "forms", [{ column: "status", op: "eq", value: "live" }]) : null,
    f.marketing_events ? countRows(tenantId, "marketing_events") : null,
    f.whatsapp_marketing ? countRows(tenantId, "whatsapp_templates") : null,
  ]);
  return { liveJourneys, liveForms, events, whatsappTemplates };
}

export async function intelligenceHomeCounts(tenantId: string, f: Record<string, boolean | undefined>): Promise<IntelligenceHomeCounts> {
  const [inMarket, scoredLeads, abmPrograms] = await Promise.all([
    f.buying_signals ? countRows(tenantId, "account_intent", [{ column: "stage", op: "in", value: ["comparing", "deciding"] }]) : null,
    f.marketing_scoring ? countRows(tenantId, "leads", [{ column: "score", op: "gte", value: 1 }]) : null,
    f.abm ? countRows(tenantId, "abm_programs", [{ column: "status", op: "eq", value: "active" }]) : null,
  ]);
  return { inMarket, scoredLeads, abmPrograms };
}
