import type { getTenant } from "@/lib/tenant";

// Mirrors useIsNextgen3Layer() (src/lib/tenant-context.tsx) for server
// components, which can't call the client hook. Single source so every
// server-side branch point (dashboard, account hub, ...) checks the exact
// same two fields.
export function isNovaTenant(tenant: Awaited<ReturnType<typeof getTenant>>): boolean {
  return tenant?.config?.appearance?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true;
}

type RichGate = {
  config?: { appearance?: { ui_theme?: string; rich_ui?: boolean } } | null;
  features?: { next_experience?: boolean } | null;
} | null | undefined;

/**
 * The "Rich" look (docs/design/rich-ui.md) is a skin over Nova, so it needs everything Nova needs (theme "nextgen2" AND the
 * platform-admin `next_experience` flag) plus the workspace's own `appearance.rich_ui` switch. Single source for the client
 * hook useRichUi() and for server components. Anything short of all three reads as off, so a stale stored value on a tenant
 * that lost the Nova flag renders exactly as before.
 */
export function isRichTenant(tenant: RichGate): boolean {
  return tenant?.config?.appearance?.ui_theme === "nextgen2"
    && tenant?.features?.next_experience === true
    && tenant?.config?.appearance?.rich_ui === true;
}
