import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import SettingsTabs from "./SettingsTabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch {
    redirect("/");
  }

  // Full admins always get in. A member with no Business Role assigned is
  // "unrestricted" (today's default -- unchanged), so they get in too. A
  // member who HAS been assigned a Business Role only gets in if at least
  // one of their roles grants edit access to something -- the settings hub
  // itself then only shows tiles for the specific object(s) that grant
  // actually covers (see settings/page.tsx's relatedWorkcenter scoping).
  // Someone with view-only grants everywhere has nothing to configure, so
  // they're kept out here rather than let in to see an empty hub.
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const hasAnyEditGrant = perms.unrestricted || [...perms.grants.values()].some((g) => g.canEdit);
  if (role !== "admin" && !hasAnyEditGrant) redirect("/");

  return (
    <SettingsTabs>
      {children}
    </SettingsTabs>
  );
}
