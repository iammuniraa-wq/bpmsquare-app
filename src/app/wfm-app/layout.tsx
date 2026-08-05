import Link from "next/link";

// Shared bottom tab bar for the employee punch app. Deliberately outside the
// CRM shell (see src/app/wfm-app/page.tsx) — this is the whole nav for
// /wfm-app, just Punch and Corrections.
export default function WfmAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "#0e1a28", paddingBottom: 64 }}>
      {children}
      <nav
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          display: "flex", background: "#152233", borderTop: "1px solid #1e2f44",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <Link
          href="/wfm-app"
          style={{ flex: 1, textAlign: "center", padding: "12px 0", color: "#e8eef4", textDecoration: "none", fontSize: 13, fontWeight: 600 }}
        >
          Punch
        </Link>
        <Link
          href="/wfm-app/corrections"
          style={{ flex: 1, textAlign: "center", padding: "12px 0", color: "#e8eef4", textDecoration: "none", fontSize: 13, fontWeight: 600 }}
        >
          Corrections
        </Link>
      </nav>
    </div>
  );
}
