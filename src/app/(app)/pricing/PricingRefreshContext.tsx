"use client";

import { createContext, useCallback, useContext, useState } from "react";

/**
 * PricingShell (the tab bar + unsaved-changes banner) and PricingSetupClient
 * (the wizard) are siblings under the same layout, with PricingShell's
 * "Discard" action deleting the version PricingSetupClient currently has
 * loaded -- but no shared state between them, so PricingSetupClient's
 * client-side `load()` (which only runs once on mount) never knew to
 * re-fetch. `router.refresh()` alone doesn't remount client components, so
 * the wizard was left pointing at a version that no longer existed until
 * the next full navigation. `bump()` gives PricingShell a way to signal
 * "something version-level changed, re-check what state you're in" without
 * either component needing to know the other's internals.
 */
type Ctx = { epoch: number; bump: () => void };

const PricingRefreshContext = createContext<Ctx>({ epoch: 0, bump: () => {} });

export function PricingRefreshProvider({ children }: { children: React.ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  const bump = useCallback(() => setEpoch((e) => e + 1), []);
  return <PricingRefreshContext.Provider value={{ epoch, bump }}>{children}</PricingRefreshContext.Provider>;
}

export function usePricingRefresh(): Ctx {
  return useContext(PricingRefreshContext);
}
