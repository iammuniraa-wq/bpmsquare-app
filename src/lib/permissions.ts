import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser } from "./supabase-server";
import { ROUTES } from "./constants";
import { WORKCENTERS, type WorkcenterKey, type ViewableWorkcenters } from "./workcenters";

export type { WorkcenterKey, ViewableWorkcenters };
export { WORKCENTERS };

export type EffectiveGrant = {
  workcenter: WorkcenterKey;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type PermissionSet = {
  /** True for admins (always) and for members with zero Business Roles
   * assigned (today's unchanged default) -- both get full, unscoped access. */
  unrestricted: boolean;
  grants: Map<WorkcenterKey, EffectiveGrant>;
};

const UNRESTRICTED: PermissionSet = { unrestricted: true, grants: new Map() };

/**
 * Resolves a tenant user's effective Business Role grants. admin always
 * bypasses (unrestricted) -- unchanged superuser tier. A member with no
 * Business Role assigned is ALSO unrestricted -- this is what keeps every
 * existing member's access unchanged the moment this feature ships;
 * assigning one or more roles is an admin OPTING that member INTO scoped
 * access, not something that silently locks anyone out. Once scoped, a
 * grant is the UNION of every assigned role for that workcenter -- the most
 * permissive applicable flag wins (two roles can only ever add access to
 * each other, never subtract).
 *
 * cache()-wrapped (request-scoped, so no cross-request or cross-tenant reuse
 * is possible): the app layout AND every page's requireWorkcenterView guard
 * both resolve the same caller on the same navigation -- previously 2x the
 * same two queries per click. cache() keys arguments by identity, which
 * works because createServerSupabase() is itself request-cached, so every
 * caller passes the same client object.
 */
export const resolvePermissions = cache(async (
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  role: "admin" | "member"
): Promise<PermissionSet> => {
  if (role === "admin") return UNRESTRICTED;

  const { data: assignments } = await supabase
    .from("business_user_roles")
    .select("role_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  if (!assignments || assignments.length === 0) return UNRESTRICTED;

  const roleIds = assignments.map((a) => a.role_id as string);
  const { data: grantRows } = await supabase
    .from("business_role_grants")
    .select("workcenter, can_view, can_create, can_edit, can_delete")
    .eq("tenant_id", tenantId)
    .in("role_id", roleIds);

  const grants = new Map<WorkcenterKey, EffectiveGrant>();
  for (const row of grantRows ?? []) {
    const key = row.workcenter as WorkcenterKey;
    const existing = grants.get(key);
    if (!existing) {
      grants.set(key, {
        workcenter: key,
        canView: row.can_view, canCreate: row.can_create, canEdit: row.can_edit, canDelete: row.can_delete,
      });
      continue;
    }
    existing.canView ||= row.can_view;
    existing.canCreate ||= row.can_create;
    existing.canEdit ||= row.can_edit;
    existing.canDelete ||= row.can_delete;
  }

  return { unrestricted: false, grants };
});

export function canViewWorkcenter(perms: PermissionSet, workcenter: WorkcenterKey): boolean {
  if (perms.unrestricted) return true;
  return perms.grants.get(workcenter)?.canView ?? false;
}

export function canEditWorkcenter(perms: PermissionSet, workcenter: WorkcenterKey): boolean {
  if (perms.unrestricted) return true;
  return perms.grants.get(workcenter)?.canEdit ?? false;
}

export function toViewableWorkcenters(perms: PermissionSet): ViewableWorkcenters {
  if (perms.unrestricted) return "all";
  return [...perms.grants.values()].filter((g) => g.canView).map((g) => g.workcenter);
}

/**
 * Page-level guard for a workcenter's top-level page(s) -- same shape as the
 * existing `if (role !== "admin") redirect(...)` guard already used by
 * /administration and /settings/* pages, just driven by resolved Business
 * Role grants instead of the raw admin/member flag. Redirects to the
 * dashboard (never throws) since this runs in a page server component, not
 * an API route.
 */
export async function requireWorkcenterView(workcenter: WorkcenterKey): Promise<void> {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.login);
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, workcenter)) redirect(ROUTES.dashboard);
}
