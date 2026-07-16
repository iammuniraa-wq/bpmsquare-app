"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MOBILE_BREAKPOINT } from "@/lib/constants";
import { c, g } from "@/lib/theme";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import { TabsProvider } from "@/lib/tabs-context";
import TabBar from "./TabBar";
import { XIcon } from "@/components/Icons";
import { useTenant } from "@/lib/tenant-context";

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
        background: g.sidebar,
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
          <span style={{ color: "#e2e7ee", fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
            {tenant?.name ?? "BPMSquare"}
          </span>
        </div>

        {/* Hamburger / close */}
        <button
          onClick={() => setOpen(v => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          style={{
            width: 36, height: 36, borderRadius: 7,
            background: open ? "rgba(255,255,255,.1)" : "transparent",
            border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 5,
          }}
        >
          {open ? (
            <XIcon size={18} color="#e2e7ee" />
          ) : (
            <>
              <span style={{ width: 18, height: 1.5, background: "#c5d3de", borderRadius: 1, display: "block" }} />
              <span style={{ width: 18, height: 1.5, background: "#c5d3de", borderRadius: 1, display: "block" }} />
              <span style={{ width: 18, height: 1.5, background: "#c5d3de", borderRadius: 1, display: "block" }} />
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

  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (mobile) {
    return (
      <TabsProvider>
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <MobileTopBar />
          <main style={{ flex: 1, padding: 12, overflowX: "auto", minWidth: 0 }}>
            {children}
          </main>
        </div>
      </TabsProvider>
    );
  }

  return (
    <TabsProvider>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <TabBar />
          <main style={{ flex: 1, padding: "20px 24px", overflowX: "hidden" }}>
            {children}
          </main>
        </div>
      </div>
    </TabsProvider>
  );
}

// Shared surface styles used across pages.
export const cardStyle: React.CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderRadius: 12,
  padding: 16,
};
