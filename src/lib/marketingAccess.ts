import "server-only";
import { NextResponse } from "next/server";
import { requireTenantUser } from "./supabase-server";
import {
  resolvePermissions, canViewWorkcenter, canEditWorkcenter, type PermissionSet, type WorkcenterKey,
} from "./permissions";

// Marketing has two workcenters -- Campaigns ("marketing") and Segmentation
// ("marketing_segments") -- and the nav item for each is gated on its own
// key. The API routes and the pages that don't have a list page of their own
// must enforce the same keys, or a Business Role that withholds one of them
// is only cosmetic.

export type MarketingLevel = "view" | "edit";

export function marketingAccessAllowed(perms: PermissionSet, workcenters: WorkcenterKey[], level: MarketingLevel): boolean {
  const check = level === "edit" ? canEditWorkcenter : canViewWorkcenter;
  return workcenters.some((w) => check(perms, w));
}

/**
 * API-route guard. `workcenters` is "any of": the saved target-group list and
 * the recipient preview are read from both the campaign composer and the
 * segment builder, so either grant is enough for those reads.
 */
export async function requireMarketingAccess(workcenters: WorkcenterKey[], level: MarketingLevel) {
  let auth;
  try {
    auth = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { error: NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 }) } as const;
  }
  const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
  if (!marketingAccessAllowed(perms, workcenters, level)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { auth } as const;
}
