import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getTenant, isPlatformAdmin } from "@/lib/tenant";
import { TenantProvider } from "@/lib/tenant-context";
import { getAuthUser } from "@/lib/supabase-server";
import { LinkIcon } from "@/components/Icons";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  // Not logged in at all
  if (!user) redirect("/login");

  const tenant = await getTenant();

  // Platform admins can use the app even without a tenant assignment
  if (!tenant) {
    const isAdmin = await isPlatformAdmin();
    if (isAdmin) {
      return (
        <TenantProvider tenant={null}>
          <Shell>{children}</Shell>
        </TenantProvider>
      );
    }
    // Regular user with no tenant — likely invite not set up yet
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", flexDirection: "column", gap: 12,
        background: "#0f1117", color: "#9ca3af", fontFamily: "system-ui",
      }}>
        <LinkIcon size={32} color="#9ca3af" />
        <div style={{ fontSize: 18, color: "#e5e7eb", fontWeight: 600 }}>No workspace found</div>
        <div style={{ fontSize: 13 }}>Your account is not linked to a workspace yet. Contact your admin.</div>
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>{user.email}</div>
      </div>
    );
  }

  if (tenant.status === "suspended") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", flexDirection: "column", gap: 12,
        background: "#0f1117", color: "#9ca3af", fontFamily: "system-ui",
      }}>
        <div style={{ fontSize: 32 }}>⛔</div>
        <div style={{ fontSize: 18, color: "#e5e7eb", fontWeight: 600 }}>Account suspended</div>
        <div style={{ fontSize: 13 }}>Contact support to reactivate your workspace.</div>
      </div>
    );
  }

  return (
    <TenantProvider tenant={tenant}>
      <style>{`:root { --tenant-accent: ${tenant.accent_color}; }`}</style>
      <Shell>{children}</Shell>
    </TenantProvider>
  );
}
