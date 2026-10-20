import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_WFM_CONFIG, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { emailOutputFor, type EmailOutput } from "@/lib/emailOutputRules";
import { topicsOf } from "@/lib/marketing/config";
import { limitsOf, type JourneyLimits } from "./safety";

// What the runner and the simulation need to know about a workspace, read once
// per tenant per tick.

export type TenantEnv = {
  tenantId: string;
  name: string;
  slug: string;
  customDomain: string | null;
  replyTo: string | undefined;
  features: Partial<TenantFeatures>;
  config: Partial<TenantConfig>;
  isDemo: boolean;
  timezone: string;
  limits: JourneyLimits;
  output: EmailOutput;
  topics: { key: string; label: string }[];
};

/** Journeys are on for this workspace only when the platform admin gave it both flags. */
export const journeysEnabled = (f: Partial<TenantFeatures> | null | undefined): boolean => f?.marketing === true && f?.journeys === true;

export async function loadTenantEnv(admin: SupabaseClient, tenantId: string): Promise<TenantEnv | null> {
  const { data, error } = await admin.from("tenants").select("name, slug, custom_domain, company_info, features, config, is_demo").eq("id", tenantId).maybeSingle();
  if (error || !data) return null;
  const t = data as { name: string; slug: string; custom_domain: string | null; company_info: { email?: string } | null; features: Partial<TenantFeatures> | null; config: Partial<TenantConfig> | null; is_demo: boolean | null };
  const config = t.config ?? {};
  const tz = config.wfm?.timezone;
  return {
    tenantId, name: t.name, slug: t.slug, customDomain: t.custom_domain, replyTo: t.company_info?.email || undefined,
    features: t.features ?? {}, config, isDemo: t.is_demo === true,
    timezone: typeof tz === "string" && tz ? tz : DEFAULT_WFM_CONFIG.timezone,
    limits: limitsOf(config),
    output: emailOutputFor({ is_demo: t.is_demo === true, config: config as TenantConfig }),
    topics: topicsOf(config).map((x) => ({ key: x.key, label: x.label })),
  };
}
