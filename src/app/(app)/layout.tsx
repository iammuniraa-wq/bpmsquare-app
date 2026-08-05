import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Shell from "@/components/Shell";
import { getTenant, getUserRole, isPlatformAdmin, redactTenantForRole } from "@/lib/tenant";
import { TenantProvider } from "@/lib/tenant-context";
import { getAuthUser, createServerSupabase } from "@/lib/supabase-server";
import { resolvePermissions, toViewableWorkcenters } from "@/lib/permissions";
import { LinkIcon } from "@/components/Icons";
import { ROUTES, PATHNAME_HEADER } from "@/lib/constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  // Not logged in at all
  if (!user) redirect("/login");

  const [tenant, userRole] = await Promise.all([getTenant(), getUserRole()]);

  // Platform admins can use the app even without a tenant assignment
  if (!tenant) {
    const isAdmin = await isPlatformAdmin();
    if (isAdmin) {
      return (
        <TenantProvider tenant={null} userRole={null}>
          <Shell>{children}</Shell>
        </TenantProvider>
      );
    }
    // Regular user with no tenant — likely invite not set up yet
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", flexDirection: "column", gap: 12,
        background: "#0f1117", color: "#9ca3af", fontFamily: "system-ui",
      }}>
        <LinkIcon size={32} color="#9ca3af" />
        <div style={{ fontSize: 18, color: "#e5e7eb", fontWeight: 600 }}>No workspace found</div>
        <div style={{ fontSize: 13 }}>Your account is not linked to a workspace yet. Contact your admin.</div>
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>{user.email}</div>
      </div>
    );
  }

  if (tenant.status === "suspended") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", flexDirection: "column", gap: 12,
        background: "#0f1117", color: "#9ca3af", fontFamily: "system-ui",
      }}>
        <div style={{ fontSize: 32 }}>⛔</div>
        <div style={{ fontSize: 18, color: "#e5e7eb", fontWeight: 600 }}>Account suspended</div>
        <div style={{ fontSize: 13 }}>Contact support to reactivate your workspace.</div>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const perms = await resolvePermissions(supabase, tenant.id, user.id, userRole ?? "member");
  const viewable = toViewableWorkcenters(perms);

  let isWfmSupervisor = false;
  let wfmEmployeeActive = false;
  if (tenant.features?.wfm) {
    const { data: membership } = await supabase
      .from("tenant_users")
      .select("employee_id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership?.employee_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("id, wfm_role")
        .eq("tenant_id", tenant.id)
        .eq("id", membership.employee_id)
        .eq("status", "active")
        .maybeSingle();
      if (employee) {
        wfmEmployeeActive = true;
        isWfmSupervisor = userRole === "admin" || employee.wfm_role === "supervisor";
      }
    }
  }

  // Every WFM login lands on My Workforce by default -- it's the useful home
  // page when WFM is this login's whole reason to be in the CRM, whether
  // that's a plain employee punching in or a supervisor whose Business Role
  // grants nothing beyond "wfm". A login with broader CRM access (viewable
  // === "all", or workcenters beyond wfm) still lands on the normal
  // dashboard -- My Workforce stays one click away via the sidebar. Applies
  // on every (app) route, not just "/", on PC and mobile alike, since this
  // layout wraps the whole CRM shell regardless of device.
  //
  // /wfm/me itself lives INSIDE this same (app) route group, so this layout
  // re-runs (and this condition re-evaluates) on every visit to /wfm/me too
  // -- without excluding it, that's an immediate infinite redirect loop, not
  // a hypothetical one. PATHNAME_HEADER is set once by middleware.ts (a
  // Server Component layout has no other way to know the current pathname).
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const restrictedToWfmOnly = Array.isArray(viewable) && viewable.every((wc) => wc === "wfm");
  if (wfmEmployeeActive && restrictedToWfmOnly && pathname !== ROUTES.wfmMe) {
    redirect(ROUTES.wfmMe);
  }

  return (
    <TenantProvider
      tenant={redactTenantForRole(tenant, userRole)}
      userRole={userRole}
      viewableWorkcenters={viewable}
      isWfmSupervisor={isWfmSupervisor}
    >
      <style>{`:root { --tenant-accent: ${tenant.accent_color}; }`}</style>
      <Shell>{children}</Shell>
    </TenantProvider>
  );
}
