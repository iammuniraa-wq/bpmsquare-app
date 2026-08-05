import Link from "next/link";
import type { Metadata } from "next";

// Its own manifest (public/wfm-manifest.json -- Next's manifest.ts special
// file only works at the app root, not per-segment, so this follows the
// same static-file pattern the root layout already uses for manifest.json)
// overrides the root CRM manifest so "Add to Home Screen" from here
// reopens the punch screen, not the full CRM. viewport-fit=cover (root
// layout.tsx) is what makes the safe-area padding below actually resolve
// to a real value.
export const metadata: Metadata = {
  manifest: "/wfm-manifest.json",
};

// Shared bottom tab bar for the employee punch app. Deliberately outside the
// CRM shell (see src/app/wfm-app/page.tsx) — this is the whole nav for
// /wfm-app: Punch, Timesheet, Corrections.
export default function WfmAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "#0e1a28", paddingBottom: "calc(60px + env(safe-area-inset-bottom))" }}>
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
          href="/wfm-app/timesheet"
          style={{ flex: 1, textAlign: "center", padding: "12px 0", color: "#e8eef4", textDecoration: "none", fontSize: 13, fontWeight: 600 }}
        >
          Timesheet
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
