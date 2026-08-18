"use client";

import { createContext, useContext } from "react";
import type { Tenant } from "./tenant";
import type { ViewableWorkcenters } from "./workcenters";

type TenantCtx = {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
  /** "all" for admins and members with no Business Role assigned (today's
   * unchanged default); otherwise the explicit list of workcenters a
   * member's assigned Business Roles grant view access to. */
  viewableWorkcenters: ViewableWorkcenters;
  /** True for tenant admins and logins linked to a wfm_role=supervisor
   * employee. Drives which Workforce sidebar sub-items render (see
   * NavItem.supervisorOnly) -- purely a display concern, not the real
   * access boundary (requireWfmSupervisorPage enforces that server-side). */
  isWfmSupervisor: boolean;
};

const TenantContext = createContext<TenantCtx>({ tenant: null, userRole: null, viewableWorkcenters: "all", isWfmSupervisor: false });

export function TenantProvider({
  tenant,
  userRole,
  viewableWorkcenters = "all",
  isWfmSupervisor = false,
  children,
}: {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
  viewableWorkcenters?: ViewableWorkcenters;
  isWfmSupervisor?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={{ tenant, userRole, viewableWorkcenters, isWfmSupervisor }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): Tenant | null {
  return useContext(TenantContext).tenant;
}

export function useUserRole(): "admin" | "member" | null {
  return useContext(TenantContext).userRole;
}

/** null return means "no restriction, show everything" -- callers should
 * treat that as always-visible rather than an empty allow-list. */
export function useViewableWorkcenters(): ViewableWorkcenters {
  return useContext(TenantContext).viewableWorkcenters;
}

export function useIsWfmSupervisor(): boolean {
  return useContext(TenantContext).isWfmSupervisor;
}

export function useTenantFeature(key: keyof Tenant["features"]): boolean {
  const { tenant } = useContext(TenantContext);
  return tenant?.features?.[key] ?? false;
}

/** The active visual theme direction (see TenantConfig.appearance.ui_theme).
 * Shell stamps this as a `data-theme` attribute on the app root, which is
 * what the CSS custom property overrides in globals.css key off. The retired
 * "modern2"/"modern3" directions may still be stored on older tenants --
 * their CSS blocks are gone, so they degrade to "modern" here rather than
 * silently falling through to an unstyled data-theme value. */
export function useUiTheme(): "classic" | "modern" | "nextgen" {
  const { tenant } = useContext(TenantContext);
  const t = tenant?.config?.appearance?.ui_theme as string | undefined;
  if (t === "nextgen" || t === "nextgen2") return "nextgen";
  if (t === "modern" || t === "modern2" || t === "modern3") return "modern";
  return "classic";
}

/** True for the "nextgen2" 3-layer variant specifically -- identity lives in
 * the top bar instead of the sidebar footer. Every other nextgen visual (CSS
 * tokens, dark mode, no-AI-dock-for-classic rule) is shared via useUiTheme()
 * above; this hook exists only for the handful of places that differ. */
export function useIsNextgen3Layer(): boolean {
  const { tenant } = useContext(TenantContext);
  return tenant?.config?.appearance?.ui_theme === "nextgen2";
}
