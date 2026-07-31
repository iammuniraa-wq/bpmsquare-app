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
