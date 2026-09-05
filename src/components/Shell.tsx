"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MOBILE_BREAKPOINT } from "@/lib/constants";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import NovaSidebar from "./NovaSidebar";
import { TabsProvider } from "@/lib/tabs-context";
import TabBar from "./TabBar";
import GlobalSearchBar from "./GlobalSearchBar";
import AIDock from "./AIDock";
import { XIcon, SearchIcon } from "@/components/Icons";
import { useTenant, useUiTheme, useTenantFeature, useIsNextgen3Layer, useIsEnterpriseSidebar, useNavySidebar, useTopBarIdentity, useCommandPalette } from "@/lib/tenant-context";
import NovaPalette from "@/components/NovaPalette";
import NovaDraft from "@/components/NovaDraft";
import NovaInbox from "@/components/NovaInbox";
import Account360Drawer from "@/components/Account360Drawer";
import FeelProvider from "@/components/FeelProvider";
import MobileTabBar from "@/components/MobileTabBar";

// ── Mobile: top bar + slide-in drawer ────────────────────────────────────────
// Renders the same <Sidebar> as desktop so nav items, ordering, favourites and
// feature-flag filtering stay identical across platforms.

function MobileTopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const tenant = useTenant();
  // On Nova the search icon opens the command palette instead of the
  // inline search overlay -- same single-search-surface rule as desktop --
  // and the drawer hosts NovaSidebar (Needs You Now / Flows / Spaces)
  // instead of the classic expandable Sidebar.
  const nova = useIsNextgen3Layer();

  // Close the drawer/search overlay whenever the route changes.
  useEffect(() => { setOpen(false); setSearchOpen(false); }, [pathname]);

  const iconBtn: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 7, flexShrink: 0,
    border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <>
      {/* Top bar */}
      {/* Installed as a home-screen app, iOS draws the status bar OVER the
          page (statusBarStyle "black-translucent" + viewportFit "cover" in
          layout.tsx). That combination requires the page to inset itself;
          nothing did, so the clock and the tenant name were printed on top
          of each other. The bar keeps its full-bleed background and grows
          by the inset instead, so it still reaches the top edge. */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100, flexShrink: 0,
        background: "var(--sb-bar-bg)",
        height: "calc(48px + env(safe-area-inset-top, 0px))",
        display: "flex", alignItems: "center",
        gap: 8,
        // Shorthand, so it must carry the top inset itself — a separate
        // paddingTop above would be silently overwritten by this line.
        padding: "env(safe-area-inset-top, 0px) 10px 0 14px",
        boxShadow: "0 1px 6px rgba(0,0,0,.45)",
      }}>
        {/* Brand -- minWidth:0 + truncated name so a long tenant name shrinks
            instead of pushing the search/menu buttons off screen (that overflow
            was why the hamburger could go missing on narrow phones). */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0 }}>
          {tenant?.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              style={{ width: 26, height: 26, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
            />
          ) : (
            <Logo size={26} />
          )}
          <span style={{
            color: "var(--sb-strong)", fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
          }}>
            {tenant?.name ?? "BPMSquare"}
          </span>
        </div>

        {/* Search + hamburger -- fixed-size icon buttons that never shrink, so
            they stay tappable regardless of how long the tenant name is. */}
        {/* Mention inbox on mobile too -- it only rendered in the desktop bar,
            leaving @mention notifications unreachable on a phone (2026-08-22
            Nova audit). Self-gates on Nova like the desktop mount. */}
        {nova && <NovaInbox />}
        <button
          onClick={() => {
            if (nova) { window.dispatchEvent(new Event("nova:open-palette")); setOpen(false); return; }
            setSearchOpen(v => !v); setOpen(false);
          }}
          aria-label={searchOpen ? "Close search" : "Search"}
          style={{ ...iconBtn, background: searchOpen ? "var(--sb-hover-strong)" : "transparent" }}
        >
          {searchOpen ? <XIcon size={18} color="var(--sb-strong)" /> : <SearchIcon size={18} color="var(--sb-strong)" />}
        </button>
        <button
          onClick={() => { setOpen(v => !v); setSearchOpen(false); }}
          aria-label={open ? "Close menu" : "Open menu"}
          style={{ ...iconBtn, flexDirection: "column", gap: 5, background: open ? "var(--sb-hover-strong)" : "transparent" }}
        >
          {open ? (
            <XIcon size={18} color="var(--sb-strong)" />
          ) : (
            <>
              <span style={{ width: 18, height: 1.5, background: "var(--sb-text)", borderRadius: 1, display: "block" }} />
              <span style={{ width: 18, height: 1.5, background: "var(--sb-text)", borderRadius: 1, display: "block" }} />
              <span style={{ width: 18, height: 1.5, background: "var(--sb-text)", borderRadius: 1, display: "block" }} />
            </>
          )}
        </button>
      </header>

      {/* Search overlay -- a full-width row anchored under the header, instead
          of squeezing the search input + object-type dropdown into the top
          bar itself (which is what made it unusable on narrow phones). */}
      {searchOpen && (
        <div style={{
          position: "sticky", top: 48, zIndex: 99,
          background: "var(--sb-bar-bg)",
          padding: "8px 14px 10px",
          boxShadow: "0 4px 14px rgba(0,0,0,.3)",
        }}>
          <GlobalSearchBar autoFocus />
        </div>
      )}

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", top: "calc(48px + env(safe-area-inset-top, 0px))", left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,.5)", zIndex: 90,
          }}
        />
      )}

      {/* Drawer — hosts the shared Sidebar */}
      <div style={{
        position: "fixed", top: "calc(48px + env(safe-area-inset-top, 0px))", left: 0,
        height: "calc(100vh - 48px)",
        zIndex: 95,
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .2s ease",
        overflowY: "auto", scrollbarWidth: "none",
        boxShadow: open ? "2px 0 14px rgba(0,0,0,.45)" : "none",
      }}>
        {nova ? <NovaSidebar onNavigate={() => setOpen(false)} /> : <Sidebar onNavigate={() => setOpen(false)} />}
      </div>

      {/* Bottom tabs (Nova only). Renders nothing for every other tenant, so
          their phones keep the hamburger they have today. */}
      <MobileTabBar onMore={() => { setOpen((v) => !v); setSearchOpen(false); }} />
    </>
  );
}

// ── Dark-mode toggle (nextgen only) ──────────────────────────────────────────
// Per-browser preference, not tenant config -- each user picks their own mode.
// Only nextgen defines the [data-mode="dark"] token overrides in globals.css;
// other themes' content styles assume a light canvas, so no toggle there.

const DARK_MODE_KEY = "bpm_nextgen_dark";

function DarkToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginLeft: 10,
        border: "1px solid var(--sb-search-border)", background: "var(--sb-search-bg)",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
      }}
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sb-search-icon)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sb-search-icon)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

// ── Identity menu (3-layer nextgen only) ─────────────────────────────────────
// Moves the sidebar footer's email/sign-out into the top bar, top-right --
// the corner most SaaS apps already put it, click to open. Same account
// lookup as Sidebar.tsx's UserFooter, kept separate rather than shared since
// the two never render at once (Sidebar hides its footer when this is on).

function IdentityMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/supabase-browser").then(({ createBrowserSupabase }) =>
      createBrowserSupabase().auth.getSession().then(({ data }) => {
        if (!cancelled) setEmail(data.session?.user?.email ?? null);
      })
    ).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    const { createBrowserSupabase } = await import("@/lib/supabase-browser");
    await createBrowserSupabase().auth.signOut();
    router.push("/login");
  }

  if (!email) return null;
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <details style={{ position: "relative", marginLeft: 10 }}>
      <summary
        style={{
          listStyle: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 7,
          height: 32, padding: "0 9px 0 5px", borderRadius: 8,
          border: "1px solid var(--sb-search-border)", background: "var(--sb-search-bg)",
        }}
      >
        <span style={{
          width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
          background: "var(--sb-hover-strong)", color: "var(--sb-strong)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 700,
        }}>
          {initials}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: "var(--sb-search-icon)",
          maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {email}
        </span>
      </summary>
      <div style={{
        position: "absolute", top: "calc(100% + 8px)", right: 0, width: 226, zIndex: 401,
        background: "var(--sb-panel-bg)", border: "1px solid var(--sb-panel-border)", borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)", padding: 8,
      }}>
        <div style={{
          fontSize: 11.5, color: "var(--sb-panel-text-dim)", padding: "4px 8px 8px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {email}
        </div>
        <button
          onClick={signOut}
          style={{
            width: "100%", textAlign: "left", padding: "8px", border: "none", borderRadius: 7,
            background: "transparent", color: "var(--sb-panel-text)", fontSize: 12.5, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sb-panel-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          ⏻ Sign out
        </button>
      </div>
    </details>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export default function Shell({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const uiTheme = useUiTheme();
  // `nova` gates the experiment itself (its own sidebar, inbox, draft,
  // Account 360 drawer). `topBarIdentity` and `commandPalette` are the two
  // pieces of that chrome a plain nextgen workspace can switch on for itself
  // -- true for Nova as well, so the Nova layout is unchanged.
  const nova = useIsNextgen3Layer();
  const topBarIdentity = useTopBarIdentity();
  const commandPalette = useCommandPalette();
  const isEnterprise = useIsEnterpriseSidebar();
  // The navy rail as an opt-in, kept apart from the Enterprise theme above:
  // that one is light-only, this one must leave dark mode alone.
  const navyRail = useNavySidebar();
  const aiAllowed = useTenantFeature("ai_assistant") && uiTheme !== "classic";
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    // Nextgen defaults to dark for a first-time visitor (no stored
    // preference yet) -- an explicit "0" from a past toggle still wins.
    try {
      const stored = localStorage.getItem(DARK_MODE_KEY);
      setDark(stored === null ? true : stored === "1");
    } catch { setDark(true); }
  }, []);
  const toggleDark = () => {
    setDark((d) => {
      const next = !d;
      try { localStorage.setItem(DARK_MODE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Enterprise is deliberately light-only for now (the reference it's
  // styled after has no dark variant) -- guarding `mode` itself, not just
  // hiding the toggle button, matters because `dark` is a per-browser
  // localStorage flag shared across every nextgen-family theme; a tenant
  // who switches FROM nextgen dark mode TO enterprise would otherwise carry
  // that true value straight into data-mode="dark" on first render.
  // `nova ||` because Nova defines its own near-black ground and glass but NOT
  // the content tokens (--line, --card-bg, --panel2) -- it inherits whichever
  // set data-mode selects. `dark` is a per-browser flag SHARED with nextgen,
  // so anyone who had chosen nextgen light and then switched to Nova landed on
  // Nova's black ground wearing light-mode borders and card fills, with no way
  // back: the dark toggle is hidden on Nova. Nova is dark by definition, so it
  // no longer asks the flag.
  const mode = uiTheme === "nextgen" && !isEnterprise && (nova || dark) ? "dark" : undefined;

  if (mobile) {
    return (
      <FeelProvider>
      <TabsProvider trackTabs={false}>
        <div data-theme={uiTheme} data-mode={mode} data-nova={nova || undefined} data-enterprise={isEnterprise || undefined} data-navy-rail={navyRail || undefined} style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--panel2)" }}>
          <MobileTopBar />
          <main style={{
            flex: 1, minWidth: 0, overflowX: "auto",
            padding: "12px",
            // Clears the fixed bottom tab bar (Nova) as well as the home
            // indicator. Harmless where no tab bar renders -- it is the same
            // spare inch a phone wants at the end of a scroll anyway.
            paddingBottom: "calc(74px + env(safe-area-inset-bottom, 0px))",
            paddingLeft: "calc(12px + env(safe-area-inset-left, 0px))",
            paddingRight: "calc(12px + env(safe-area-inset-right, 0px))",
          }}>
            {children}
          </main>
          {uiTheme === "nextgen" && !isEnterprise && !nova && (
            <div style={{ position: "fixed", left: 16, bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", zIndex: 90 }}>
              <DarkToggle dark={dark} onToggle={toggleDark} />
            </div>
          )}
          {commandPalette && <NovaPalette />}
          {nova && <NovaDraft />}
          {nova && <Account360Drawer />}
          {aiAllowed && <AIDock liftForTabBar={nova} />}
        </div>
      </TabsProvider>
      </FeelProvider>
    );
  }

  return (
    <FeelProvider>
    <TabsProvider>
      <div data-theme={uiTheme} data-mode={mode} data-nova={nova || undefined} data-enterprise={isEnterprise || undefined} data-navy-rail={navyRail || undefined} style={{ display: "flex", minHeight: "100vh", background: "var(--panel2)" }}>
        {nova ? <NovaSidebar /> : <Sidebar />}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
            background: "var(--sb-bar-bg)", borderBottom: "1px solid var(--sb-line)",
            height: 48, minHeight: 48, flexShrink: 0, padding: "0 16px",
          }}>
            {/* Nova's own left rail carries its own "Ask or act…" command
                bar on every page (NovaSidebar) -- a second, identical
                search trigger up here was pure duplication (owner flagged
                2026-08-23). Classic/nextgen keep their inline search. */}
            {/* The bar stays clickable when the palette is on, but gives up
                ⌘K to it -- otherwise both answer the same key. */}
            {!nova && <GlobalSearchBar hotkeyDisabled={commandPalette} />}
            {uiTheme === "nextgen" && !isEnterprise && !nova && <DarkToggle dark={dark} onToggle={toggleDark} />}
            {nova && <NovaInbox />}
            {topBarIdentity && <IdentityMenu />}
          </div>
          {commandPalette && <NovaPalette />}
          {nova && <NovaDraft />}
          {nova && <Account360Drawer />}
          <TabBar />
          {/* overflowX:auto, not hidden -- "hidden" silently clips any page whose content
              runs wider than the viewport with no way to reach it (short of zooming the
              browser out). "auto" degrades to a scrollbar instead. */}
          <main style={{ flex: 1, padding: "20px 24px", overflowX: "auto" }}>
            {children}
          </main>
        </div>
        {aiAllowed && <AIDock />}
      </div>
    </TabsProvider>
    </FeelProvider>
  );
}

// Shared surface styles used across pages. Theme-reactive via CSS custom
// properties (see globals.css) -- a tenant opted into appearance.ui_theme:
// "modern" gets sharper radii + a subtle shadow here with zero per-page
// changes, since every page already just spreads this constant.
export const cardStyle: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--line)",
  borderRadius: "var(--card-radius)",
  padding: 16,
  boxShadow: "var(--card-shadow)",
};
