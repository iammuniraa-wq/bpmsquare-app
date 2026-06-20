"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MOBILE_BREAKPOINT, NAV, ROUTES } from "@/lib/constants";
import { c, g, pillar } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import Logo from "./Logo";
import Sidebar from "./Sidebar";

// ── Mobile: top bar + slide-in drawer ────────────────────────────────────────

function MobileTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { settings } = useSettings();
  const accent = ACCENT_PRESETS[settings.accentPreset].color;
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

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
          <Logo size={26} />
          <span style={{ color: "#e2e7ee", fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
            VeveyCRM
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
            <span style={{ color: "#e2e7ee", fontSize: 18, lineHeight: 1, fontWeight: 300 }}>✕</span>
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

      {/* Drawer */}
      <nav style={{
        position: "fixed", top: 48, left: 0,
        width: 250, height: "calc(100vh - 48px)",
        background: g.sidebar,
        zIndex: 95,
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .2s ease",
        overflowY: "auto", scrollbarWidth: "none",
        padding: "14px 8px 24px",
        boxSizing: "border-box",
      }}>
        {NAV.map((group) => (
          <div key={group.group} style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, color: "#4a6070",
              letterSpacing: "0.1em", textTransform: "uppercase",
              padding: "0 10px", marginBottom: 5,
            }}>
              {group.group}
            </div>
            {group.items.map((item) => {
              const on = isActive(item.href);
              return (
                <button
                  key={item.href}
                  onClick={() => { router.push(item.href); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "9px 10px", borderRadius: 8,
                    border: "none", cursor: "pointer", marginBottom: 2,
                    background: on ? accent : "transparent",
                    color: on ? "#fff" : "#9db3c4",
                    fontSize: 13.5, fontWeight: on ? 600 : 400,
                    textAlign: "left",
                    transition: "background .12s, color .12s",
                  }}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: "center", flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge != null && (
                    <span style={{
                      background: pillar.red.base, color: "#fff",
                      fontSize: 10, fontWeight: 700,
                      borderRadius: 10, padding: "1px 6px", lineHeight: 1.6,
                    }}>
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {/* Settings */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 12 }}>
          <button
            onClick={() => { router.push(ROUTES.settings); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "9px 10px", borderRadius: 8,
              border: "none", cursor: "pointer",
              background: pathname.startsWith(ROUTES.settings) ? accent : "transparent",
              color: pathname.startsWith(ROUTES.settings) ? "#fff" : "#9db3c4",
              fontSize: 13.5, fontWeight: 400, textAlign: "left",
            }}
          >
            <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>⚙</span>
            <span>Settings</span>
          </button>
        </div>
      </nav>
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
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <MobileTopBar />
        <main style={{ flex: 1, padding: 12, overflowX: "auto", minWidth: 0 }}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: "20px 24px", overflowX: "hidden", maxWidth: 1100 }}>
        {children}
      </main>
    </div>
  );
}

// Shared surface styles used across pages.
export const cardStyle: React.CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderRadius: 12,
  padding: 16,
};
