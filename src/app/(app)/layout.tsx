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

/** Spectacular's three colour knobs, as :root overrides.
 *
 * globals.css declares the shipped violet as the default for each, so a key
 * left unset here simply never emits a line and the default stands -- which
 * is also why a workspace can change only the accent and keep the shell.
 *
 * HEX_COLOR_RE on every value, not for tidiness: this is interpolated into a
 * raw <style> tag with no escaping, exactly like nova_accent_color above, so
 * anything that is not a real #rrggbb is dropped rather than trusted. The
 * settings route rejects it on the way in too; this is the second of the two
 * places that has to hold. */
function specColorVars(colors: { shell_from?: string; shell_to?: string; accent?: string } | undefined): string {
  if (!colors) return "";
  const pairs: [string, string | undefined][] = [
    ["--spec-shell-from", colors.shell_from],
    ["--spec-shell-to", colors.shell_to],
    ["--spec-accent", colors.accent],
  ];
  return pairs
    .filter(([, v]) => HEX_COLOR_RE.test(v ?? ""))
    .map(([name, v]) => `${name}: ${v};`)
    .join("\n        ");
}

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

  // NOTE -- there is deliberately NO "/" redirect here any more.
  //
  // Landing a WFM workspace on My Workforce shipped 2026-09-10 as a redirect
  // on "/" in this layout, which re-runs on every navigation. That made it a
  // permanent rule rather than a landing page: an admin who pressed
  // Dashboard, or who came back to "/" after saving a setting or adapting
  // their layout, was thrown into the punch screen before finishing (owner,
  // 2026-09-21). The rule now lives in api/auth/landing alone, where it runs
  // once per sign-in, and is gated on config.wfm.home_landing so it applies
  // only to a tenant that asked for it.
  //
  // (tenant_users.wfm_default_landing, the older per-user preference, is
  // still unused -- it was superseded by that 2026-09-10 redirect and is not
  // revived here.)

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
        ${specColorVars(tenant.config?.appearance?.spectacular_colors)}
      }`}</style>
      <Shell>{children}</Shell>
    </TenantProvider>
  );
}
