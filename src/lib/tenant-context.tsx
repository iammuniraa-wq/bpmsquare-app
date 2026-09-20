"use client";

import { createContext, useContext } from "react";
import type { Tenant } from "./tenant";
import type { ViewableWorkcenters } from "./workcenters";
import { resolveCurrency, type CurrencyDef } from "./currency";

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

/** The tenant's currency (TenantConfig.currency; INR when unset). Client
 *  components format every money figure through this -- never a literal
 *  symbol -- so one setting drives the whole workspace. */
export function useCurrency(): CurrencyDef {
  const { tenant } = useContext(TenantContext);
  return resolveCurrency(tenant?.config);
}

/** Whether the quote-line pricing trace shows the actual rate/formula and
 *  the values it ran on (TenantConfig.pricing.trace_detail), not just which
 *  rule matched. Undefined/unset reads as ON -- explainability is the
 *  trust-building default (see PriceTrace's `detailed` prop). */
export function useTraceDetail(): boolean {
  const { tenant } = useContext(TenantContext);
  return tenant?.config?.pricing?.trace_detail !== false;
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
  if (t === "nextgen" || t === "nextgen2" || t === "enterprise" || t === "spectacular" || t === "spectacular_purple") return "nextgen";
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

/** True for the "Spectacular" direction in EITHER palette (owner request
 * 2026-09-19, from an Able Pro dashboard reference; the lilac palette added
 * 2026-09-20): nextgen's structure with its own full token set. Shell.tsx
 * stamps data-spectacular="true" from this, and globals.css redefines the
 * full nextgen token set behind that stamp. Use useSpectacularVariant()
 * below when the palette itself matters.
 *
 * Same double gate as useIsEnterpriseSidebar() above -- the ui_theme value
 * AND a platform-admin-only feature flag, so a stored choice can never
 * render for a tenant the flag was later taken off (bpmsquarecore.md §10:
 * nothing experimental reaches an existing client on its own). */
export function useIsSpectacular(): boolean {
  return useSpectacularVariant() !== null;
}

/** Which Spectacular PALETTE is in play, or null when the theme isn't on.
 *
 * Owner request 2026-09-20: a second, lilac/violet reference. It is the same
 * direction -- same navy-band-shaped chrome, same filled KPI tiles, same
 * 200-odd CSS rules -- with a different hue, so it is modelled as a variant
 * rather than a theme. Shell stamps data-spectacular="true" (unchanged, so
 * every existing rule still matches) PLUS data-spectacular-variant, and
 * globals.css carries one small override block that redefines only the
 * hue-carrying custom properties. Duplicating the whole block per palette is
 * exactly how half-themed screens happen when one copy later gains a rule.
 *
 * Both palettes ride the single spectacular_theme flag -- see the note on it
 * in TenantFeatures. The double gate is unchanged: the stored ui_theme value
 * AND the platform-admin-only flag (bpmsquarecore.md section 10). */
export function useSpectacularVariant(): "navy" | "purple" | null {
  const { tenant } = useContext(TenantContext);
  return spectacularVariantOf(tenant);
}

/** The same resolution as a plain function, for the hooks above that need it
 * as one branch among several -- a hook cannot be called conditionally. */
function spectacularVariantOf(
  tenant: { config?: { appearance?: Record<string, unknown> }; features?: Record<string, unknown> } | null | undefined
): "navy" | "purple" | null {
  if (tenant?.features?.spectacular_theme !== true) return null;
  const t = tenant?.config?.appearance?.ui_theme;
  if (t === "spectacular") return "navy";
  if (t === "spectacular_purple") return "purple";
  return null;
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
  return nextgenChromeOn(useContext(TenantContext).tenant, "navy_sidebar");
}

/**
 * The three pieces of chrome nextgen now ships WITH: the navy light-mode
 * rail, the signed-in name in the top right, and Ctrl+K.
 *
 * They are part of the theme, not a setup step -- the owner asked for nextgen
 * to have them, and defaulting them off meant a deploy where nothing visibly
 * changed. The stored booleans survive as off-switches only: `undefined`
 * (nobody has touched it) reads as ON, and only an explicit `false` from the
 * Appearance toggles turns one back off.
 *
 * Plain "nextgen" only. "nextgen2" is Nova, which has its own answers for all
 * three, and "enterprise" already carries the navy rail through its own path.
 */
function nextgenChromeOn(
  tenant: { config?: { appearance?: Record<string, unknown> } } | null | undefined,
  key: "navy_sidebar" | "top_bar_identity" | "command_palette"
): boolean {
  const ap = tenant?.config?.appearance;
  return ap?.ui_theme === "nextgen" && ap?.[key] !== false;
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
  if (tenant?.config?.appearance?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true) return true;
  // Spectacular, both palettes (owner request 2026-09-20: "move user details
  // on the top right like in nova"). Not optional the way it is for plain
  // nextgen: the rail's footer identity block is the widest thing in it, and
  // with the lilac palette's light chrome the rail is meant to read as a thin
  // navigation sheet rather than a panel with a profile card stuck to the
  // bottom. Sidebar.tsx reads this same hook to drop its footer copy, so the
  // identity never renders twice.
  if (spectacularVariantOf(tenant) !== null) return true;
  return nextgenChromeOn(tenant, "top_bar_identity");
}

/** Whether Ctrl/Cmd+K opens the command palette. Same split as
 *  useTopBarIdentity() above -- the palette is self-contained (it reads NAV
 *  and /api/search, nothing Nova-only), so a nextgen workspace can have it
 *  without the experiment around it. GlobalSearchBar gives up the hotkey
 *  whenever this is on, so the two never fight over ⌘K. */
export function useCommandPalette(): boolean {
  const { tenant } = useContext(TenantContext);
  if (tenant?.config?.appearance?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true) return true;
  return nextgenChromeOn(tenant, "command_palette");
}

/**
 * Whether this workspace mounts the record/list surfaces that were BUILT for
 * Nova -- the Quote/Case Field, Lanes and List, the record timeline and its
 * inbox, Account 360, and the account constellation.
 *
 * True for Nova itself, and now for Spectacular (owner request 2026-09-21,
 * from the "Inside the shell" proposal): the shell was the only thing
 * Spectacular had that Nova didn't, and a violet shell wrapped around the
 * plain list pages was a frame with nothing in it.
 *
 * Deliberately NOT useIsNextgen3Layer() widened. That hook means "this is
 * Nova" and still governs Nova's own experience layer -- NovaSidebar, the
 * draft/stream/story pieces, the account landing page. This one means "this
 * workspace gets those surfaces", which is a smaller claim: a Spectacular
 * tenant renders the same components inside the ordinary Shell, against the
 * light --nova-* token set globals.css defines for [data-spectacular]. Both
 * sides stay doubly gated (theme value AND platform-admin-only feature flag),
 * so bpmsquarecore.md section 10 rule 1 holds -- no existing client reaches
 * any of this.
 */
export function useNovaSurfaces(): boolean {
  const { tenant } = useContext(TenantContext);
  if (tenant?.config?.appearance?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true) return true;
  return spectacularVariantOf(tenant) !== null;
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
