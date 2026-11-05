import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_WFM_CONFIG, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";

export type CrewTenant = {
  id: string; slug: string; name: string; is_demo: boolean | null; custom_domain: string | null;
  features: Partial<TenantFeatures>; config: TenantConfig; timezone: string; hasTimezone: boolean; pooledBudget: number;
};

export async function loadCrewTenant(admin: SupabaseClient, tenantId: string): Promise<CrewTenant | null> {
  const { data } = await admin.from("tenants").select("id, slug, name, is_demo, custom_domain, features, config").eq("id", tenantId).maybeSingle();
  if (!data) return null;
  const r = data as { id: string; slug: string; name: string; is_demo: boolean | null; custom_domain: string | null; features: Partial<TenantFeatures> | null; config: TenantConfig | null };
  const config = (r.config ?? {}) as TenantConfig;
  const tz = config.wfm?.timezone;
  return {
    id: r.id, slug: r.slug, name: r.name, is_demo: r.is_demo, custom_domain: r.custom_domain, features: r.features ?? {}, config,
    timezone: tz || DEFAULT_WFM_CONFIG.timezone, hasTimezone: !!tz,
    pooledBudget: resolveMonthlyBudget((config as { ai_assistant?: { monthly_token_budget?: unknown } }).ai_assistant?.monthly_token_budget),
  };
}
