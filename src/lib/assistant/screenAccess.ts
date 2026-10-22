import "server-only";

import type { PermissionSet } from "@/lib/permissions";
import { canCreateWorkcenter, canEditWorkcenter, canViewWorkcenter } from "@/lib/permissions";
import type { ScreenAccess } from "./screens/types";

/** The gates the sidebar, the Settings menu and the palette use, in the shape the screen manifests are filtered by. */
export function screenAccessFor(perms: PermissionSet, features: Record<string, boolean | undefined>, isAdmin: boolean): ScreenAccess {
  return {
    features, isAdmin,
    canView: (wc) => canViewWorkcenter(perms, wc),
    canCreate: (wc) => canCreateWorkcenter(perms, wc),
    canEdit: (wc) => canEditWorkcenter(perms, wc),
  };
}

/**
 * The caller's field configuration for an object, through their own session and their own tenant id. Imported on use:
 * a failure (or a test without a database) only costs the field list, never the screen.
 */
export async function loadFieldSections(supabase: Parameters<typeof import("@/lib/fieldConfig").getEffectiveFieldConfig>[0], tenantId: string, objectType: string) {
  const { getEffectiveFieldConfig } = await import("@/lib/fieldConfig");
  return (await getEffectiveFieldConfig(supabase, tenantId, objectType)).sections;
}
