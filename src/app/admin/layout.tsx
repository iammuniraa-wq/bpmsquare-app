import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/tenant";
import { c } from "@/lib/theme";
import Logo from "@/components/Logo";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) redirect("/");

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      {/* Admin sidebar */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: "#0a0f1a",
        borderRight: "1px solid #1e2a3a",
        padding: "20px 12px",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 8, marginBottom: 28 }}>
          <Logo size={28} />
          <div>
            <div style={{ color: "#e2e7ee", fontWeight: 700, fontSize: 13 }}>
              BPM<span style={{ color: c.accent }}>Square</span>
            </div>
            <div style={{ color: "#dc2626", fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>
              PLATFORM ADMIN
            </div>
          </div>
        </div>

        {([
          { href: "/admin", label: "Tenants", icon: "▣" },
          { href: "/admin/tenants/new", label: "Add tenant", icon: "＋" },
        ] as const).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 10px", borderRadius: 8, marginBottom: 2,
              color: "#9db3c4", textDecoration: "none", fontSize: 13,
            }}
          >
            <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>{item.icon}</span>
            {item.label}
          </Link>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid #1e2a3a" }}>
          <Link
            href="/"
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "8px 10px", borderRadius: 8,
              color: "#6b7280", textDecoration: "none", fontSize: 12,
            }}
          >
            ← Back to app
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1,
        background: "#f8fafc",
        padding: "28px 32px",
        overflowY: "auto",
      }}>
        {children}
      </main>
    </div>
  );
}
