import type { TenantFeatures } from "@/lib/constants";

/** The module needs Marketing AND the platform-admin flag; anything else is "not there". */
export function signalsEnabled(features: Partial<TenantFeatures> | null | undefined): boolean {
  return features?.marketing === true && features?.buying_signals === true;
}
