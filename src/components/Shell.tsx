"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MOBILE_BREAKPOINT } from "@/lib/constants";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import { TabsProvider } from "@/lib/tabs-context";
import TabBar from "./TabBar";
import GlobalSearchBar from "./GlobalSearchBar";
import AIDock from "./AIDock";
import { XIcon } from "@/components/Icons";
import { useTenant, useUiTheme } from "@/lib/tenant-context";

// ── Mobile: top bar + slide-in drawer ────────────────────────────────────────
// Renders the same <Sidebar> as desktop so nav items, ordering, favourites and
// feature-flag filtering stay identical across platforms.

function MobileTopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tenant = useTenant();

  // Close the drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      {/* Top bar */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100, flexShrink: 0,
        background: "var(--sidebar-grad)",
        height: 48,
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        boxShadow: "0 1px 6px rgba(0,0,0,.45)",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {tenant?.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              style={{ width: 26, height: 26, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
            />
          ) : (
            <Logo size={26} />
          )}
          <span style={{ color: "var(--sb-strong)", fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            {tenant?.name ?? "BPMSquare"}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0, maxWidth: 260 }}>
          <GlobalSearchBar />
        </div>

        {/* Hamburger / close */}
        <button
          onClick={() => setOpen(v => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          style={{
            width: 36, height: 36, borderRadius: 7,
            background: open ? "var(--sb-hover-strong)" : "transparent",
            border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 5,
          }}
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

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", top: 48, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,.5)", zIndex: 90,
          }}
        />
      )}

      {/* Drawer — hosts the shared Sidebar */}
      <div style={{
        position: "fixed", top: 48, left: 0,
        height: "calc(100vh - 48px)",
        zIndex: 95,
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .2s ease",
        overflowY: "auto", scrollbarWidth: "none",
        boxShadow: open ? "2px 0 14px rgba(0,0,0,.45)" : "none",
      }}>
        <Sidebar onNavigate={() => setOpen(false)} />
      </div>
    </>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export default function Shell({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const uiTheme = useUiTheme();

  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (mobile) {
    return (
      <TabsProvider>
        <div data-theme={uiTheme} style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <MobileTopBar />
          <main style={{ flex: 1, padding: 12, overflowX: "auto", minWidth: 0 }}>
            {children}
          </main>
          {uiTheme !== "classic" && <AIDock />}
        </div>
      </TabsProvider>
    );
  }

  return (
    <TabsProvider>
      <div data-theme={uiTheme} style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            background: "var(--sidebar-grad)", borderBottom: "1px solid var(--sb-line)",
            height: 48, minHeight: 48, flexShrink: 0, padding: "0 16px",
          }}>
            <GlobalSearchBar />
          </div>
          <TabBar />
          {/* overflowX:auto, not hidden -- "hidden" silently clips any page whose content
              runs wider than the viewport with no way to reach it (short of zooming the
              browser out). "auto" degrades to a scrollbar instead. */}
          <main style={{ flex: 1, padding: "20px 24px", overflowX: "auto" }}>
            {children}
          </main>
        </div>
        {uiTheme !== "classic" && <AIDock />}
      </div>
    </TabsProvider>
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
