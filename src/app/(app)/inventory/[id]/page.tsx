import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { getInventoryLive } from "@/lib/data/live";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import { ROUTES } from "@/lib/constants";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import InventoryEditPanel from "./InventoryEditPanel";
import AdjustStockPanel from "./AdjustStockPanel";

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

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

export default async function InventoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("purchasing");
  const { id } = await params;
  const data = await getInventoryLive(id);
  if (!data) notFound();
  const { item, supplier, transactions } = data;

  const low = item.reorder_level != null && item.qty_on_hand <= item.reorder_level;

  return (
    <>
      <TabTitle title={item.name} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.inventory} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All inventory
        </Link>
      </div>

      <PageHeader
        title={item.name}
        subtitle={`${item.sku ? `SKU ${item.sku} · ` : ""}${item.category ?? "Uncategorised"}`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start", marginTop: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <section style={cardStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>
              Stock
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: low ? "#a32d2d" : c.ink }}>{item.qty_on_hand}</span>
              <span style={{ fontSize: 13, color: c.hint }}>{item.uom} on hand</span>
              {low && <Pill label="Low stock" tone="red" />}
            </div>
            {item.reorder_level != null && (
              <div style={{ fontSize: 12, color: c.muted }}>Reorder level: {item.reorder_level} {item.uom}</div>
            )}
            {item.unit_cost != null && (
              <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>Unit cost: ₹{item.unit_cost.toLocaleString("en-IN")}</div>
            )}
            {item.description && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "14px 0 12px" }} />
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{item.description}</p>
              </>
            )}
            {item.notes && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "14px 0 12px" }} />
                <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Notes</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{item.notes}</p>
              </>
            )}
          </section>

          <AdjustStockPanel itemId={item.id} uom={item.uom} />

          <section style={cardStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
              Recent stock movements
            </div>
            {transactions.length === 0 ? (
              <div style={{ fontSize: 12.5, color: c.hint }}>No movements yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {transactions.map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
                    <div>
                      <span style={{ fontWeight: 600, color: t.qty_delta > 0 ? "#1d9e75" : "#a32d2d" }}>
                        {t.qty_delta > 0 ? "+" : ""}{t.qty_delta} {item.uom}
                      </span>
                      <span style={{ color: c.hint, marginLeft: 8 }}>
                        {t.type === "receipt" ? "Received (PO)" : "Manual adjustment"}
                      </span>
                      {t.note && <span style={{ color: c.hint }}> — {t.note}</span>}
                    </div>
                    <div style={{ color: c.hint, fontSize: 11, whiteSpace: "nowrap" }}>{fmtDateTime(t.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <CustomFieldsSection
            objectType="inventory"
            recordId={item.id}
            customData={item.custom_data}
            patchUrl={`/api/inventory/${item.id}`}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Pill label={item.status === "active" ? "Active" : "Inactive"} tone={item.status === "active" ? "green" : "red"} />
            </div>
            <CtxLabel>Supplier</CtxLabel>
            {supplier ? (
              <Link href={ROUTES.supplier(supplier.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                {supplier.name}
              </Link>
            ) : (
              <div style={{ fontSize: 13, color: c.hint }}>None set</div>
            )}
            <CtxLabel>Added</CtxLabel>
            <CtxRow label="Date" value={new Date(item.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />
          </section>

          <InventoryEditPanel item={item} />
        </div>
      </div>
    </>
  );
}
