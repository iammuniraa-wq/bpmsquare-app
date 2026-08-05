import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getTenant, getUserRole, isPlatformAdmin, redactTenantForRole } from "@/lib/tenant";
import { TenantProvider } from "@/lib/tenant-context";
import { getAuthUser, createServerSupabase } from "@/lib/supabase-server";
import { resolvePermissions, toViewableWorkcenters } from "@/lib/permissions";
import { LinkIcon } from "@/components/Icons";

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

  // A Business Role granting ZERO workcenters means "nothing in the CRM is
  // relevant to this login" -- for a WFM field employee (their whole job is
  // punching in via /wfm-app), landing on an empty CRM shell with nothing to
  // click is a dead end. Bounce them straight there instead, on every (app)
  // route, not just "/" -- this layout wraps the whole CRM shell regardless
  // of device, so the same redirect applies on PC and mobile alike. Safe
  // against a redirect loop: /wfm-app itself only exists outside this route
  // group's layout, and its own page bounces back to "/" only when
  // features.wfm is off, which is exactly the condition checked below.
  if (Array.isArray(viewable) && viewable.length === 0 && tenant.features?.wfm) {
    const { data: membership } = await supabase
      .from("tenant_users")
      .select("employee_id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership?.employee_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("id", membership.employee_id)
        .eq("status", "active")
        .maybeSingle();
      if (employee) redirect("/wfm-app");
    }
  }

  return (
    <TenantProvider tenant={redactTenantForRole(tenant, userRole)} userRole={userRole} viewableWorkcenters={toViewableWorkcenters(perms)}>
      <style>{`:root { --tenant-accent: ${tenant.accent_color}; }`}</style>
      <Shell>{children}</Shell>
    </TenantProvider>
  );
}
