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
  // "enterprise" folds into nextgen for every BEHAVIOUR check (real SVG nav
  // icons, denser modern-style cards, etc.) -- it only diverges visually,
  // via the separate data-enterprise attribute below, same precedent as
  // "nextgen2" (Nova) folding into nextgen while useIsNextgen3Layer() carries
  // its own structural difference.
  if (t === "nextgen" || t === "nextgen2" || t === "enterprise") return "nextgen";
  if (t === "modern" || t === "modern2" || t === "modern3") return "modern";
  return "classic";
}

/** True for the "Enterprise" direction specifically (owner request
 * 2026-08-24: nextgen's light content with a dark navy sidebar, styled
 * after a clean-enterprise-SaaS reference). Shell.tsx stamps
 * data-enterprise="true" from this so globals.css can override just the
 * --sb-* (sidebar chrome) token family back to dark values, while every
 * other nextgen token (cards, KPI tiles, charts, accent) stays exactly as
 * nextgen light already defines it.
 *
 * Doubly gated, same shape as useIsNextgen3Layer() above -- owner
 * correction 2026-08-25: it first shipped as a plain opt-in (no flag), and
 * surfaced directly in the demo tenant's own picker, which is not this
 * codebase's pattern for new experimental UI. The tenant must ALSO carry
 * the platform-admin-only enterprise_theme feature flag; a stored
 * "enterprise" ui_theme with the flag off (e.g. the demo tenant's already-
 * saved choice) now falls back to plain nextgen rather than rendering. */
export function useIsEnterpriseSidebar(): boolean {
  const { tenant } = useContext(TenantContext);
  return tenant?.config?.appearance?.ui_theme === "enterprise"
    && tenant?.features?.enterprise_theme === true;
}

/**
 * The navy rail as a plain switch, for a nextgen workspace that wants the
 * dark left rail without adopting the whole Enterprise theme.
 *
 * Deliberately NOT folded into useIsEnterpriseSidebar(): that hook also
 * forces light mode (the Enterprise direction is light-only by design, see
 * Shell's `mode`), so reusing it would have made turning this on silently
 * disable dark mode and hide its toggle. The owner's request was the
 * opposite -- "dark mode is fine, navy the left nav in bright mode" -- so
 * this stamps its own attribute and the CSS applies only outside dark mode.
 */
export function useNavySidebar(): boolean {
  const { tenant } = useContext(TenantContext);
  const ap = tenant?.config?.appearance;
  return isNextgenFamily(ap?.ui_theme) && ap?.navy_sidebar === true;
}

/** The nextgen family, for the tenant-owned chrome switches below. "nextgen2"
 *  and "enterprise" both resolve to nextgen in useUiTheme(), so all three
 *  count -- these switches are meaningless on classic/modern, whose chrome is
 *  built differently. */
function isNextgenFamily(t: string | undefined): boolean {
  return t === "nextgen" || t === "nextgen2" || t === "enterprise";
}

/**
 * Whether the signed-in identity lives in the top-right bar rather than the
 * sidebar footer.
 *
 * True for Nova (which has always worked this way), and now also for any
 * nextgen workspace that switched it on itself. The two are kept as separate
 * conditions on purpose: Nova's version comes bundled with NovaSidebar,
 * NovaInbox and the rest of the experiment, and Shell still gates all of
 * that on useIsNextgen3Layer(). This hook governs the identity menu alone.
 */
export function useTopBarIdentity(): boolean {
  const { tenant } = useContext(TenantContext);
  const ap = tenant?.config?.appearance;
  if (ap?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true) return true;
  return isNextgenFamily(ap?.ui_theme) && ap?.top_bar_identity === true;
}

/** Whether Ctrl/Cmd+K opens the command palette. Same split as
 *  useTopBarIdentity() above -- the palette is self-contained (it reads NAV
 *  and /api/search, nothing Nova-only), so a nextgen workspace can have it
 *  without the experiment around it. GlobalSearchBar gives up the hotkey
 *  whenever this is on, so the two never fight over ⌘K. */
export function useCommandPalette(): boolean {
  const { tenant } = useContext(TenantContext);
  const ap = tenant?.config?.appearance;
  if (ap?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true) return true;
  return isNextgenFamily(ap?.ui_theme) && ap?.command_palette === true;
}

/** True for the "nextgen2" 3-layer variant specifically -- identity lives in
 * the top bar instead of the sidebar footer, and the engagement layer
 * (celebrations, silence detector, loss intelligence, fog of war) hangs off
 * this. Every other nextgen visual (CSS tokens, dark mode) is shared via
 * useUiTheme() above.
 *
 * Doubly gated (owner doctrine 2026-08-19): the tenant must ALSO carry the
 * platform-admin-only `next_experience` feature flag. A stored "nextgen2"
 * theme with the flag off renders as plain nextgen with zero experimental
 * behavior -- so existing clients can never reach the experiment, even by a
 * stale stored value. */
export function useIsNextgen3Layer(): boolean {
  const { tenant } = useContext(TenantContext);
  return tenant?.config?.appearance?.ui_theme === "nextgen2"
    && tenant?.features?.next_experience === true;
}
