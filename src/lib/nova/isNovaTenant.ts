import type { getTenant } from "@/lib/tenant";

// Mirrors useIsNextgen3Layer() (src/lib/tenant-context.tsx) for server
// components, which can't call the client hook. Single source so every
// server-side branch point (dashboard, account hub, ...) checks the exact
// same two fields.
export function isNovaTenant(tenant: Awaited<ReturnType<typeof getTenant>>): boolean {
  return tenant?.config?.appearance?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true;
}
