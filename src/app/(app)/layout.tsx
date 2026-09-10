import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Shell from "@/components/Shell";
import { getTenant, getUserRole, isPlatformAdmin, redactTenantForRole } from "@/lib/tenant";
import { TenantProvider } from "@/lib/tenant-context";
import { getAuthUser, createServerSupabase, getTenantMembership } from "@/lib/supabase-server";
import { resolvePermissions, toViewableWorkcenters } from "@/lib/permissions";
import { LinkIcon } from "@/components/Icons";
import { ROUTES, PATHNAME_HEADER } from "@/lib/constants";
import { HEX_COLOR_RE } from "@/lib/standardQuoteTemplateBlocks";

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

  // One parallel step instead of the old sequential chain: the membership
  // row (password gate + WFM employee link, request-cached and shared with
  // requireTenantUser) and the caller's Business Role grants (request-cached
  // and shared with every page's requireWorkcenterView) don't depend on
  // each other -- awaiting them one by one just stacked roundtrips.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const [membership, perms] = await Promise.all([
    getTenantMembership(tenant.id, user.id),
    resolvePermissions(supabase, tenant.id, user.id, userRole ?? "member"),
  ]);

  // A password an admin just set for this login (fresh creation, or a
  // later reset) forces a stop here until they set their own -- see
  // must_change_password on tenant_users (0073). Reads the pathname
  // header middleware.ts already sets, same as the WFM redirect below, so
  // /force-password-change itself is never redirected to itself.
  if (membership?.must_change_password && pathname !== "/force-password-change") {
    redirect("/force-password-change");
  }

  const viewable = toViewableWorkcenters(perms);

  let isWfmSupervisor = false;
  let wfmEmployeeActive = false;
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

  // My Workforce is THE home of a WFM workspace, for every role (owner
  // decision 2026-09-10, BIM: "make it hard My Workforce"). Anyone with an
  // active employee record who opens "/" goes there -- employee, supervisor
  // and admin alike. Not a tenant setting: the product now has one answer to
  // "where does a WFM workspace start", so there is nothing to configure.
  //
  // Scoped to "/" ONLY. A supervisor who opens the Live board, Roster,
  // Employees or Corrections must still get the page they asked for --
  // bouncing them back from those was the old blanket behaviour, and it made
  // the whole supervisor toolset unreachable. This replaces the previous
  // per-user landing preference for "/" (tenant_users.wfm_default_landing),
  // which no longer has an effect there.
  //
  // Requires an ACTIVE employee record, and that is a correctness floor
  // rather than a preference: with no employee record My Workforce can only
  // report "you aren't set up yet", so an unlinked admin keeps the dashboard
  // instead of landing on a dead end.
  //
  // /wfm/me lives inside this same (app) route group, so this layout re-runs
  // on every visit to it -- hence "/" only here, and the explicit wfmMe
  // exclusion in the employee branch below. Without those it is an immediate
  // redirect loop, not a hypothetical one. (`pathname` comes from
  // PATHNAME_HEADER, set once by middleware.ts -- a Server Component layout
  // has no other way to know the current path.)
  if (wfmEmployeeActive && pathname === "/") {
    redirect(ROUTES.wfmMe);
  }

  // A WFM-restricted login (Business Role grants nothing beyond "wfm") has no
  // use for any other page: every other (app) route is a dead end for them,
  // so a plain employee is bounced back to My Workforce from ANYWHERE, not
  // just "/". Supervisors are deliberately left alone here -- they
  // legitimately use the Live board, Roster, Employees, Corrections, Leave
  // and Summary, all gated by this same "wfm" workcenter key.
  const restrictedToWfmOnly = Array.isArray(viewable) && viewable.every((wc) => wc === "wfm");
  if (wfmEmployeeActive && restrictedToWfmOnly && !isWfmSupervisor && pathname !== ROUTES.wfmMe) {
    redirect(ROUTES.wfmMe);
  }

  return (
    <TenantProvider
      tenant={redactTenantForRole(tenant, userRole)}
      userRole={userRole}
      viewableWorkcenters={viewable}
      isWfmSupervisor={isWfmSupervisor}
    >
      <style>{`:root {
        --tenant-accent: ${tenant.accent_color};
        ${HEX_COLOR_RE.test(tenant.config?.appearance?.nova_accent_color ?? "") ? `--nova-accent-color: ${tenant.config!.appearance!.nova_accent_color};` : ""}
      }`}</style>
      <Shell>{children}</Shell>
    </TenantProvider>
  );
}
