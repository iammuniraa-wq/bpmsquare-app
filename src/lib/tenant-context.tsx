"use client";

import { createContext, useContext } from "react";
import type { Tenant } from "./tenant";

type TenantCtx = {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
  badges: Record<string, number>;
};

const TenantContext = createContext<TenantCtx>({ tenant: null, userRole: null, badges: {} });

export function TenantProvider({
  tenant,
  userRole,
  badges,
  children,
}: {
  tenant: Tenant | null;
  userRole: "admin" | "member" | null;
  badges?: Record<string, number>;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={{ tenant, userRole, badges: badges ?? {} }}>
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

/** Live per-tenant counts for sidebar nav badges, keyed by ROUTES href. */
export function useNavBadges(): Record<string, number> {
  return useContext(TenantContext).badges;
}
