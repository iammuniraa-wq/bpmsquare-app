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
