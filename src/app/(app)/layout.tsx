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

  // A password an admin just set for this login (fresh creation, or a
  // later reset) forces a stop here until they set their own -- see
  // must_change_password on tenant_users (0073). Reads the pathname
  // header middleware.ts already sets, same as the WFM redirect below, so
  // /force-password-change itself is never redirected to itself.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const { data: passwordGate } = await supabase
    .from("tenant_users")
    .select("must_change_password")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (passwordGate?.must_change_password && pathname !== "/force-password-change") {
    redirect("/force-password-change");
  }

  const perms = await resolvePermissions(supabase, tenant.id, user.id, userRole ?? "member");
  const viewable = toViewableWorkcenters(perms);

  let isWfmSupervisor = false;
  let wfmEmployeeActive = false;
  let wfmDefaultLanding: string | null = null;
  if (tenant.features?.wfm) {
    // A tenant admin is a full unrestricted superuser everywhere else in the
    // app (resolvePermissions() returns UNRESTRICTED for role === "admin"
    // regardless of Business Roles) -- WFM's own supervisor-only nav items
    // (Live Board, Roster, Employees, Corrections; see Sidebar.tsx's
    // supervisorOnly filter) need to follow that same rule. Previously this
    // was only ever set true INSIDE the membership/employee lookup below, so
    // an admin who manages the business but isn't also linked to a WFM
    // employee record (the common case -- most admins aren't themselves a
    // tracked worker) saw none of them, same as a plain employee would.
    //
    // A Business Role that explicitly grants edit access on "wfm" counts
    // too -- same rule as requireWfm()'s own isSupervisor (src/lib/wfm/
    // server.ts), which is the actual API-level enforcement boundary; nav
    // visibility has to match it or a role like "WFM Admin" shows nothing
    // despite the API actually allowing it (or, worse, the reverse). Reuses
    // `perms` already computed above -- not perms.unrestricted, which is
    // also true for a plain member with zero roles assigned (today's
    // "no role = full access" default) and must never auto-promote them.
    isWfmSupervisor = userRole === "admin" || perms.grants.get("wfm")?.canEdit === true;
    const { data: membership } = await supabase
      .from("tenant_users")
      .select("employee_id, wfm_default_landing")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();
    wfmDefaultLanding = membership?.wfm_default_landing ?? null;
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
        isWfmSupervisor = isWfmSupervisor || employee.wfm_role === "supervisor";
      }
    }
  }

  // A WFM-restricted login (Business Role grants nothing beyond "wfm") has
  // no use for the generic CRM dashboard, so "/" sends them somewhere
  // useful instead. The two roles need different treatment, though:
  //
  // - A plain employee's ONLY legitimate page is My Workforce -- every
  //   other (app) route would be a dead end for them anyway (no other
  //   workcenter is granted), so this bounces them back from anywhere,
  //   not just "/". Unchanged from before.
  // - A supervisor legitimately uses Live Board, Roster, Employees,
  //   Corrections, Leave and Summary too -- all still gated by the SAME
  //   "wfm" workcenter key, just supervisor-only in the nav. Forcing them
  //   back to My Workforce from those pages (the old blanket behaviour)
  //   made the rest of the WFM supervisor toolset unreachable. So a
  //   supervisor is only ever redirected away from the plain dashboard
  //   ("/"), to their chosen landing page (Live Board by default, or
  //   Dashboard if they've said so via wfm_default_landing) -- never away
  //   from a page they're already legitimately on.
  //
  // /wfm/me itself lives INSIDE this same (app) route group, so this layout
  // re-runs (and this condition re-evaluates) on every visit to it too --
  // without excluding it in the employee branch, that's an immediate
  // infinite redirect loop, not a hypothetical one. `pathname` was already
  // read above for the password-gate check (PATHNAME_HEADER is set once by
  // middleware.ts -- a Server Component layout has no other way to know
  // the current pathname).
  const restrictedToWfmOnly = Array.isArray(viewable) && viewable.every((wc) => wc === "wfm");
  if (wfmEmployeeActive && restrictedToWfmOnly) {
    if (isWfmSupervisor) {
      if (pathname === "/" && wfmDefaultLanding !== "dashboard") {
        redirect(ROUTES.wfmLiveBoard);
      }
    } else if (pathname !== ROUTES.wfmMe) {
      redirect(ROUTES.wfmMe);
    }
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
