import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import SettingsShell from "@/components/settings/SettingsShell";
import { getVisibleSettingsMenu } from "@/lib/settingsMenuServer";

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
  // one of their roles grants edit access to something -- the settings menu
  // itself then only shows entries for the specific object(s) that grant
  // actually covers (see lib/settingsMenu.ts's relatedWorkcenter scoping).
  // Someone with view-only grants everywhere has nothing to configure, so
  // they're kept out here rather than let in to see an empty menu.
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const hasAnyEditGrant = perms.unrestricted || [...perms.grants.values()].some((g) => g.canEdit);
  if (role !== "admin" && !hasAnyEditGrant) redirect("/");

  const groups = await getVisibleSettingsMenu();

  return <SettingsShell groups={groups}>{children}</SettingsShell>;
}
