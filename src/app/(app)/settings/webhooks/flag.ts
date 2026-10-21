"use client";

import { useTenant } from "@/lib/tenant-context";
import { webhooksLibraryOn } from "./logic";

// A flag read by name, so these screens compile and behave the same whether or not `webhooks_library` has landed in
// TenantFeatures yet: a missing key is simply off, which is what an unflagged tenant must see.

export function useTenantFeatureByName(key: string): boolean {
  const features = useTenant()?.features as unknown as Record<string, unknown> | undefined;
  return features?.[key] === true;
}

/** True when the platform admin switched the Webhooks library on for this workspace. */
export function useWebhooksLibrary(): boolean {
  return webhooksLibraryOn(useTenant()?.features);
}
