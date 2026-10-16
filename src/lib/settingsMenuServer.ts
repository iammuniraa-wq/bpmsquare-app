import "server-only";
import { cache } from "react";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { getTenant } from "@/lib/tenant";
import type { TenantFeatures } from "@/lib/constants";
import { toMenuGroups, visibleSettingsMenu, type SettingsMenuGroup } from "@/lib/settingsMenu";

/**
 * The Settings menu for the signed-in person on this host. cache()-wrapped
 * (request-scoped) because the layout draws it and the landing page lists it
 * on the same navigation.
 */
export const getVisibleSettingsMenu = cache(async (): Promise<SettingsMenuGroup[]> => {
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const tenant = await getTenant();
  const features = tenant?.features as Partial<TenantFeatures> | undefined;
  return toMenuGroups(
    visibleSettingsMenu({
      isAdmin: role === "admin",
      canEdit: (wc) => canEditWorkcenter(perms, wc),
      features,
    }),
  );
});
