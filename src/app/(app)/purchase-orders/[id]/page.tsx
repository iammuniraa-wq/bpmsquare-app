import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature, getUserRole } from "@/lib/tenant";
import { getPurchaseOrderLive } from "@/lib/data/live";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import { c, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import { ROUTES } from "@/lib/constants";
import type { PurchaseOrderStatus } from "@/lib/types";
import ObjectSections from "@/components/fields/ObjectSections";
import PurchaseOrderActionsPanel from "./PurchaseOrderActionsPanel";
import ReceivePanel from "./ReceivePanel";

const STATUS_TONE: Record<PurchaseOrderStatus, PillarKey> = {
  draft: "blue", sent: "amber", partially_received: "teal", received: "green", cancelled: "red",
};
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft", sent: "Sent", partially_received: "Partially received", received: "Received", cancelled: "Cancelled",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

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

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("purchasing");
  const { id } = await params;
  const [data, role] = await Promise.all([getPurchaseOrderLive(id), getUserRole()]);
  if (!data) notFound();
  const { po, lines, supplier, quote, serviceCase } = data;

  const canReceive = !["received", "cancelled"].includes(po.status) && lines.some((l) => l.qty_received < l.qty_ordered);

  return (
    <>
      <TabTitle title={po.ref} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.purchaseOrders} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All purchase orders
        </Link>
      </div>

      <PageHeader
        title={po.ref}
        subtitle={`Procurement · ${supplier?.name ?? ""}`}
        action={<AdaptObjectDrawer objectType="purchase_order" objectLabel="Purchase Order" isAdmin={role === "admin"} />}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start", marginTop: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${c.line}` }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>Line items</h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={{ textAlign: "left", padding: "7px 14px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Description</th>
                  <th style={{ textAlign: "center", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>UOM</th>
                  <th style={{ textAlign: "right", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Ordered</th>
                  <th style={{ textAlign: "right", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Received</th>
                  <th style={{ textAlign: "right", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Rate</th>
                  <th style={{ textAlign: "right", padding: "7px 14px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ padding: "8px 14px", fontSize: 13 }}>{l.description}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 12.5, color: c.muted }}>{l.uom ?? ""}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12.5 }}>{l.qty_ordered}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12.5, color: l.qty_received >= l.qty_ordered ? "#1d9e75" : c.muted, fontWeight: l.qty_received >= l.qty_ordered ? 600 : 400 }}>
                      {l.qty_received}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12.5, color: c.muted }}>{inr(l.rate)}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 13, fontWeight: 500 }}>{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 14px", borderTop: `1px solid ${c.line}` }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Total: {inr(po.total)}</div>
            </div>
          </section>

          {canReceive && <ReceivePanel poId={po.id} lines={lines} />}

          <ObjectSections
            objectType="purchase_order"
            record={po as unknown as Record<string, unknown>}
            patchUrl={`/api/purchase-orders/${po.id}`}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px" }}>
            <div style={{ marginBottom: 10 }}>
              <Pill label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} />
            </div>
            <CtxLabel>Supplier</CtxLabel>
            {supplier ? (
              <Link href={ROUTES.supplier(supplier.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                {supplier.name}
              </Link>
            ) : <div style={{ fontSize: 13, color: c.hint }}>—</div>}

            {quote && (
              <>
                <CtxLabel>Linked quote</CtxLabel>
                <Link href={ROUTES.quotation(quote.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600, fontFamily: "monospace" }}>
                  {quote.ref}
                </Link>
              </>
            )}
            {serviceCase && (
              <>
                <CtxLabel>Linked case</CtxLabel>
                <Link href={ROUTES.case(serviceCase.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600, fontFamily: "monospace" }}>
                  {serviceCase.ref}
                </Link>
              </>
            )}

            <CtxLabel>Dates</CtxLabel>
            <CtxRow label="Order date" value={po.order_date ? fmtDate(po.order_date) : "—"} />
            <CtxRow label="Expected" value={po.expected_date ? fmtDate(po.expected_date) : "—"} />
            <CtxRow label="Created" value={fmtDate(po.created_at)} />
          </section>

          <PurchaseOrderActionsPanel po={po} />
        </div>
      </div>
    </>
  );
}
