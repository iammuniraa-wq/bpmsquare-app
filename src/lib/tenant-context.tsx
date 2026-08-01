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
};

const TenantContext = createContext<TenantCtx>({ tenant: null, userRole: null, viewableWorkcenters: "all" });

export function TenantProvider({
  tenant,
  userRole,
  viewableWorkcenters = "all",
  children,
}: {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
  viewableWorkcenters?: ViewableWorkcenters;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={{ tenant, userRole, viewableWorkcenters }}>
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
  if (t === "nextgen") return "nextgen";
  if (t === "modern" || t === "modern2" || t === "modern3") return "modern";
  return "classic";
}
