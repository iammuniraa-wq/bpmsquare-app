import type { PricingCategory, PricingItem } from "@/lib/types";
import type { TenantFeatures } from "@/lib/constants";

// Pure rules behind Settings > Pricing (batch S3 of docs/design/settings-simplification.md).

export const PRICING_CATEGORIES: PricingCategory[] = ["labour", "material", "testing", "transport"];
export const CATEGORY_LABEL: Record<PricingCategory, string> = { labour: "Labour", material: "Material", testing: "Testing", transport: "Transport" };

export type PriceFilter = "all" | PricingCategory;
export const PRICE_FILTERS: { id: PriceFilter; label: string }[] = [{ id: "all", label: "All" }, ...PRICING_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABEL[id] }))];

export function filterItems(items: PricingItem[], filter: PriceFilter): PricingItem[] {
  return filter === "all" ? items : items.filter((i) => i.category === filter);
}

/** What the page offers: the rate card with Quotations, the link into the engine with Dynamic Pricing. */
export function pricingParts(features: Partial<TenantFeatures> | undefined): { rateCard: boolean; engine: boolean } {
  return { rateCard: features?.quotations === true, engine: features?.pricing_engine === true };
}

export type PriceDraft = { id: string | null; category: PricingCategory; description: string; unit: string; rate: string; notes: string };

export const blankPrice = (filter: PriceFilter): PriceDraft => ({ id: null, category: filter === "all" ? "labour" : filter, description: "", unit: "", rate: "", notes: "" });
export const draftOfItem = (i: PricingItem): PriceDraft => ({ id: i.id, category: i.category, description: i.description, unit: i.unit, rate: String(i.rate), notes: i.notes ?? "" });

export function priceProblem(d: PriceDraft): string | null {
  if (!d.description.trim()) return "Describe what the rate is for.";
  if (!d.unit.trim()) return "Say what the rate is per, for example per job.";
  const rate = Number(d.rate === "" ? 0 : d.rate);
  if (!Number.isFinite(rate) || rate < 0) return "The rate must be zero or more.";
  return null;
}

export function planPriceSave(d: PriceDraft): { url: string; method: "POST" | "PATCH"; body: Record<string, unknown> } {
  const body = { category: d.category, description: d.description.trim(), unit: d.unit.trim(), rate: Number(d.rate) || 0, notes: d.notes.trim() || null };
  return d.id === null ? { url: "/api/settings/pricing", method: "POST", body } : { url: `/api/settings/pricing/${d.id}`, method: "PATCH", body };
}
