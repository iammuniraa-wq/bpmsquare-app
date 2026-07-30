"use client";

import { createContext, useContext } from "react";
import type { Tenant } from "./tenant";

type TenantCtx = {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
};

const TenantContext = createContext<TenantCtx>({ tenant: null, userRole: null });

export function TenantProvider({
  tenant,
  userRole,
  children,
}: {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={{ tenant, userRole }}>
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

export function useTenantFeature(key: keyof Tenant["features"]): boolean {
  const { tenant } = useContext(TenantContext);
  return tenant?.features?.[key] ?? false;
}

/** The active visual theme direction -- "classic" for every tenant unless a
 * platform admin has explicitly opted this one into "modern", "modern2" or
 * "modern3" (see TenantConfig.appearance.ui_theme). Shell stamps this as a
 * `data-theme` attribute on the app root, which is what the CSS custom
 * property overrides in globals.css key off. */
export function useUiTheme(): "classic" | "modern" | "modern2" | "modern3" | "nextgen" {
  const { tenant } = useContext(TenantContext);
  const t = tenant?.config?.appearance?.ui_theme;
  return t === "modern" || t === "modern2" || t === "modern3" || t === "nextgen" ? t : "classic";
}
