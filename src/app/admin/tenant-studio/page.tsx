import Link from "next/link";
import TenantStudioClient from "./TenantStudioClient";

/**
 * Tenant Creation Studio. /admin is already platform-admin-only — its layout
 * gates every page under it (src/app/admin/layout.tsx) — and both studio
 * routes re-check isPlatformAdmin() for themselves, so this page carries no
 * gate of its own.
 */
export default function TenantStudioPage() {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin" style={{ fontSize: 12.5, color: "#6b7280", textDecoration: "none" }}>← Tenants</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700, color: "#111827" }}>Tenant Creation Studio</h1>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: "#6b7280", maxWidth: 680, lineHeight: 1.65 }}>
          Describe the client and the studio drafts the whole provisioning plan — modules, Business
          Roles, nav visibility, users and employees. Keep typing to change it. Nothing is created
          until you say so, and the three steps that live outside the app are listed for you.
        </p>
      </div>
      <TenantStudioClient />
      <style>{`@media (max-width: 900px) { .studio-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
