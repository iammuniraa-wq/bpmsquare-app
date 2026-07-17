import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { listPurchaseOrdersLive } from "@/lib/data/live";
import { c, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { PurchaseOrderStatus } from "@/lib/types";

const STATUS_TONE: Record<PurchaseOrderStatus, PillarKey> = {
  draft: "blue", sent: "amber", partially_received: "teal", received: "green", cancelled: "red",
};
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft", sent: "Sent", partially_received: "Partially received", received: "Received", cancelled: "Cancelled",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireFeature("purchasing");
  const { status: statusFilter } = await searchParams;
  const rows = await listPurchaseOrdersLive();

  const filtered = statusFilter && statusFilter !== "all" ? rows.filter((r) => r.po.status === statusFilter) : rows;
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.po.status] = (acc[r.po.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle={`Procurement · ${rows.length} orders`}
        action={
          <Link
            href={ROUTES.purchaseOrderNew}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + Create PO
          </Link>
        }
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { id: "all", label: `All (${rows.length})` },
          ...(Object.keys(STATUS_LABEL) as PurchaseOrderStatus[]).map((s) => ({ id: s, label: `${STATUS_LABEL[s]} (${counts[s] ?? 0})` })),
        ].map(({ id, label }) => {
          const active = (statusFilter ?? "all") === id;
          return (
            <Link key={id} href={`${ROUTES.purchaseOrders}?status=${id}`} style={{
              fontSize: 12.5, fontWeight: active ? 700 : 500,
              color: active ? c.accent : c.muted,
              background: active ? c.accentbg : c.panel2,
              border: `1px solid ${active ? c.accent + "60" : c.line}`,
              borderRadius: 6, padding: "5px 12px", textDecoration: "none",
            }}>
              {label}
            </Link>
          );
        })}
      </div>

      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            No purchase orders{statusFilter && statusFilter !== "all" ? ` with status "${STATUS_LABEL[statusFilter as PurchaseOrderStatus] ?? statusFilter}"` : " yet"}.
            {(!statusFilter || statusFilter === "all") && (
              <div style={{ marginTop: 12 }}>
                <Link href={ROUTES.purchaseOrderNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                  + Create your first purchase order
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                  <th style={th}>PO ID</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Status</th>
                  <th style={th}>Order date</th>
                  <th style={th}>Total</th>
                  <th style={{ ...th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ po, supplier }) => (
                  <tr key={po.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={td}>
                      <Link href={ROUTES.purchaseOrder(po.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5, fontFamily: "monospace" }}>
                        {po.ref}
                      </Link>
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>{supplier?.name ?? "—"}</td>
                    <td style={td}>
                      <Pill label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} />
                    </td>
                    <td style={{ ...td, color: c.hint, fontSize: 12, whiteSpace: "nowrap" }}>{po.order_date ? fmtDate(po.order_date) : "—"}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{inr(po.total)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Link href={ROUTES.purchaseOrder(po.id)} style={{
                        fontSize: 11.5, fontWeight: 600, color: c.accent,
                        background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                        textDecoration: "none", whiteSpace: "nowrap",
                      }}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
