import Link from "next/link";
import { adminListTenants } from "@/lib/tenant";
import type { Tenant, TenantFeatures } from "@/lib/tenant";
import { c } from "@/lib/theme";

const FEATURE_LABELS: { key: keyof TenantFeatures; label: string }[] = [
  { key: "leads",        label: "Leads" },
  { key: "pipeline",     label: "Pipeline" },
  { key: "amc",          label: "AMC" },
  { key: "dispatch",     label: "Dispatch" },
  { key: "invoices",     label: "Invoices" },
  { key: "partners",     label: "Partners" },
  { key: "ai_assistant", label: "AI" },
  { key: "db_export",    label: "DB Export" },
];

function StatusPill({ status }: { status: Tenant["status"] }) {
  const map = {
    active:    { bg: "#dcfce7", color: "#166534", label: "Active" },
    suspended: { bg: "#fee2e2", color: "#991b1b", label: "Suspended" },
    trial:     { bg: "#fef9c3", color: "#854d0e", label: "Trial" },
  };
  const s = map[status];
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 20, padding: "2px 10px",
      fontSize: 11, fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

function PlanPill({ plan }: { plan: Tenant["plan"] }) {
  const map = {
    personal:       { bg: "#f1f5f9", color: "#475569", label: "Personal" },
    small_business: { bg: "#eff6ff", color: "#1d4ed8", label: "Small business" },
    enterprise:     { bg: "#faf5ff", color: "#7e22ce", label: "Enterprise" },
  };
  const s = map[plan];
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 20, padding: "2px 10px",
      fontSize: 11, fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

export default async function AdminPage() {
  const tenants = await adminListTenants();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Tenants</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
            {tenants.length} workspace{tenants.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/admin/tenants/new"
          style={{
            background: c.accent, color: "#fff",
            borderRadius: 9, padding: "9px 18px",
            textDecoration: "none", fontSize: 13, fontWeight: 500,
          }}
        >
          + Add tenant
        </Link>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {tenants.map((t) => (
          <div key={t.id} style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "16px 20px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
              {/* Accent swatch */}
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: t.accent_color,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>/{t.slug}</div>
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <StatusPill status={t.status} />
                <PlanPill plan={t.plan} />
                <Link
                  href={`/admin/tenants/${t.id}`}
                  style={{
                    marginLeft: 8,
                    background: "#f1f5f9", color: "#475569",
                    borderRadius: 7, padding: "6px 14px",
                    textDecoration: "none", fontSize: 12, fontWeight: 500,
                  }}
                >
                  Manage →
                </Link>
              </div>
            </div>

            {/* Feature flags */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FEATURE_LABELS.map(({ key, label }) => {
                const on = t.features?.[key] ?? false;
                return (
                  <span key={key} style={{
                    fontSize: 11, fontWeight: 500,
                    padding: "3px 9px", borderRadius: 20,
                    background: on ? "#dbeafe" : "#f9fafb",
                    color: on ? "#1e40af" : "#9ca3af",
                    border: `1px solid ${on ? "#bfdbfe" : "#e5e7eb"}`,
                  }}>
                    {on ? "✓" : "○"} {label}
                  </span>
                );
              })}
            </div>
          </div>
        ))}

        {tenants.length === 0 && (
          <div style={{
            textAlign: "center", padding: "48px 20px",
            color: "#9ca3af", fontSize: 14,
            background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
          }}>
            No tenants yet. <Link href="/admin/tenants/new" style={{ color: c.accent }}>Add the first one →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
