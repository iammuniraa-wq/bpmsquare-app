"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, ROUTES, WORKSPACE_NAME } from "@/lib/constants";
import { c, g } from "@/lib/theme";
import Logo from "./Logo";

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === ROUTES.pipeline
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      style={{
        width: 236,
        background: g.sidebar,
        flexShrink: 0,
        padding: "16px 12px",
        color: "#aebccd",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "4px 6px 14px",
          borderBottom: "1px solid rgba(255,255,255,.08)",
          marginBottom: 8,
        }}
      >
        <Logo size={34} />
        <div>
          <div style={{ fontWeight: 600, color: "#fff", fontSize: 14 }}>
            Vevey<span style={{ color: "#7fb4ec" }}>CRM</span>
          </div>
          <div style={{ fontSize: 11, color: "#8aa0b8" }}>{WORKSPACE_NAME}</div>
        </div>
      </div>

      <nav>
        {NAV.map((grp) => (
          <div key={grp.group}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 1.2,
                color: "#5d6f82",
                margin: "14px 0 4px",
                paddingLeft: 10,
              }}
            >
              {grp.group}
            </div>
            {grp.items.map((item) => {
              const on = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 13,
                    marginBottom: 1,
                    color: on ? "#fff" : "#aebccd",
                    background: on ? c.accent : "transparent",
                  }}
                >
                  <span style={{ width: 16, textAlign: "center", fontSize: 14 }}>
                    {item.icon}
                  </span>
                  {item.label}
                  {item.badge != null && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 10,
                        background: "rgba(255,255,255,.14)",
                        color: "#dce6f1",
                        borderRadius: 10,
                        padding: "1px 7px",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
