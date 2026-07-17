import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Supplier } from "@/lib/types";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import SupplierEditPanel from "./SupplierEditPanel";

const TYPE_LABEL: Record<Supplier["type"], string> = {
  vendor: "Vendor", subcontractor: "Subcontractor", both: "Vendor & Sub",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 5 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function CtxLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, marginTop: 14, marginBottom: 4 }}>
      {children}
    </div>
  );
}

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, tenantId } = await requireTenantUser();
  const { id } = await params;

  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) notFound();
  const supplier = data as Supplier;

  return (
    <>
      <TabTitle title={supplier.name} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.suppliers} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All suppliers
        </Link>
      </div>

      <PageHeader
        title={supplier.name}
        subtitle={`${TYPE_LABEL[supplier.type]}${supplier.city ? ` · ${supplier.city}` : ""}`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start", marginTop: 16 }}>

        {/* Main panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Contact info */}
          <section style={cardStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>
              Contact information
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Phone</div>
                <div style={{ fontSize: 13.5, color: supplier.phone ? c.ink : c.hint }}>
                  {supplier.phone ?? "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Email</div>
                {supplier.email ? (
                  <a href={`mailto:${supplier.email}`} style={{ fontSize: 13.5, color: c.accent, textDecoration: "none" }}>
                    {supplier.email}
                  </a>
                ) : (
                  <div style={{ fontSize: 13.5, color: c.hint }}>—</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>City</div>
                <div style={{ fontSize: 13.5, color: supplier.city ? c.ink : c.hint }}>
                  {supplier.city ?? "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>GSTIN</div>
                <div style={{ fontSize: 13, color: supplier.gstin ? c.ink : c.hint, fontFamily: supplier.gstin ? "monospace" : "inherit" }}>
                  {supplier.gstin ?? "—"}
                </div>
              </div>
            </div>

            {supplier.notes && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "14px 0 12px" }} />
                <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Notes</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{supplier.notes}</p>
              </>
            )}
          </section>

          <CustomFieldsSection
            objectType="supplier"
            recordId={supplier.id}
            customData={supplier.custom_data}
            patchUrl={`/api/suppliers/${supplier.id}`}
          />

        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Pill label={TYPE_LABEL[supplier.type]} tone={supplier.type === "vendor" ? "blue" : supplier.type === "subcontractor" ? "amber" : "teal"} />
              <Pill label={supplier.status === "active" ? "Active" : "Inactive"} tone={supplier.status === "active" ? "green" : "red"} />
            </div>
            <CtxLabel>Added</CtxLabel>
            <CtxRow label="Date" value={fmtDate(supplier.created_at)} />
          </section>

          <SupplierEditPanel supplier={supplier} />
        </div>
      </div>

      <style>{`@media (max-width: 860px) { .supp-body { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
