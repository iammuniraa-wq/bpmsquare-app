import type { MarketingConfig, MarketingTopic, TenantConfig, TenantFeatures } from "@/lib/constants";
import { isJurisdictionCode, JURISDICTIONS, type ConsentBasisSetting, type JurisdictionCode } from "./jurisdictions";

// Reading and validating tenants.config.marketing. Pure.

export const DEFAULT_TOPICS: MarketingTopic[] = [
  { key: "offers", label: "Offers", hint: "Price lists, promotions and special deals." },
  { key: "new_products", label: "New products", hint: "News about products and ranges we have just added." },
  { key: "service_reminders", label: "Service reminders", hint: "Reminders about servicing, renewals and your equipment." },
  { key: "events", label: "Events", hint: "Invitations to shows, demos and webinars." },
];

/** True when this workspace has the marketing scoring and consent program switched on (platform admin sets it). */
export function marketingScoringOn(features: Partial<TenantFeatures> | null | undefined): boolean {
  return features?.marketing === true && features?.marketing_scoring === true;
}

export function marketingConfigOf(config: Partial<TenantConfig> | null | undefined): MarketingConfig {
  return (config?.marketing ?? {}) as MarketingConfig;
}

export function topicsOf(config: Partial<TenantConfig> | null | undefined): MarketingTopic[] {
  const saved = marketingConfigOf(config).topics;
  return Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_TOPICS;
}

export function consentDefaultsOf(config: Partial<TenantConfig> | null | undefined): Partial<Record<JurisdictionCode, ConsentBasisSetting>> {
  return marketingConfigOf(config).consent_defaults ?? {};
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/**
 * Validates the topic list a settings page sends. A topic's key is what the
 * consent ledger stores, so an existing key is kept as-is (a rename changes
 * only the label); a new topic gets a key from its label. Keys are unique.
 * A topic cannot be deleted by leaving it out of the list if it has history --
 * the route checks that; this only shapes the list.
 */
export function sanitizeTopics(input: unknown): MarketingTopic[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: MarketingTopic[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 40) : "";
    if (!label) continue;
    let key = typeof o.key === "string" && /^[a-z0-9_]{1,40}$/.test(o.key) ? o.key : slug(label);
    if (!key) continue;
    if (seen.has(key)) {
      let n = 2;
      while (seen.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    seen.add(key);
    out.push({ key, label, hint: typeof o.hint === "string" ? o.hint.trim().slice(0, 160) : "" });
  }
  return out.slice(0, 20);
}

export function sanitizeConsentDefaults(input: unknown): Partial<Record<JurisdictionCode, ConsentBasisSetting>> {
  const out: Partial<Record<JurisdictionCode, ConsentBasisSetting>> = {};
  if (!input || typeof input !== "object") return out;
  for (const code of JURISDICTIONS) {
    const v = (input as Record<string, unknown>)[code];
    if (v === "existing_customer" || v === "consent_required") out[code] = v;
  }
  return out;
}

export { isJurisdictionCode };
