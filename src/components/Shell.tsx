"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MOBILE_BREAKPOINT } from "@/lib/constants";
import { c, g } from "@/lib/theme";
import Logo from "./Logo";
import Sidebar from "./Sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {!mobile && <Sidebar />}

      {mobile && open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 40 }}
          />
          <div style={{ position: "fixed", inset: "0 auto 0 0", zIndex: 50 }}>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}

      <main style={{ flex: 1, maxWidth: 1100, padding: mobile ? 14 : "20px 24px", overflowX: "hidden" }}>
        {mobile && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              marginBottom: 12,
              borderRadius: 10,
              background: g.sidebar,
            }}
          >
            <button
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              style={{ background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}
            >
              ☰
            </button>
            <Logo size={26} />
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>
              Vevey<span style={{ color: "#7fb4ec" }}>CRM</span>
            </span>
          </div>
        )}
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
