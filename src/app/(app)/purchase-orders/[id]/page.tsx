import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature, getUserRole, getTenantCurrency } from "@/lib/tenant";
import { moneyFormatter } from "@/lib/currency";
import { getPurchaseOrderLive } from "@/lib/data/live";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { ROUTES } from "@/lib/constants";
import type { PurchaseOrderStatus } from "@/lib/types";
import ObjectSections from "@/components/fields/ObjectSections";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList from "@/components/page/RelatedList";
import RecordActionButton, { type RecordAction } from "@/components/page/recordActions";
import ReceivePanel from "./ReceivePanel";

const STATUS_TONE: Record<PurchaseOrderStatus, PillarKey> = {
  draft: "blue", sent: "amber", partially_received: "teal", received: "green", cancelled: "red",
};
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft", sent: "Sent", partially_received: "Partially received", received: "Received", cancelled: "Cancelled",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 5 }}>
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

export default async function PurchaseOrderDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireFeature("purchasing");
  const inr = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });
  const { id } = await params;
  const { tab } = await searchParams;
  const [data, role] = await Promise.all([getPurchaseOrderLive(id), getUserRole()]);
  if (!data) notFound();
  const { po, lines, supplier, quote, serviceCase } = data;
  const isAdmin = role === "admin";
  const basePath = ROUTES.purchaseOrder(po.id);

  const canReceive = !["received", "cancelled"].includes(po.status) && lines.some((l) => l.qty_received < l.qty_ordered);
  const isDraft = po.status === "draft";

  const markSent: RecordAction = { label: "Mark as sent", endpoint: `/api/purchase-orders/${po.id}`, body: { status: "sent" }, errorText: "Failed to update status" };
  const actions: RecordAction[] = [
    {
      label: "Cancel order", endpoint: `/api/purchase-orders/${po.id}`, body: { status: "cancelled" }, danger: true,
      hidden: ["draft", "cancelled", "received"].includes(po.status),
      confirm: { title: "Cancel this purchase order?", body: "It stays on record as cancelled — nothing is deleted.", confirmLabel: "Cancel PO", cancelLabel: "Keep it", tone: "danger" },
      errorText: "Failed to update status",
    },
  ];

  return (
    <ObjectRecordPage
      backHref={ROUTES.purchaseOrders}
      backLabel="All purchase orders"
      title={po.ref}
      meta={`Procurement${supplier?.name ? ` · ${supplier.name}` : ""}`}
      status={<StatusPill label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} />}
      primaryAction={
        isDraft
          ? <RecordActionButton action={markSent} />
          : canReceive
            ? <Button href={`${basePath}?tab=lines`} variant="primary">Receive stock</Button>
            : undefined
      }
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          actions={actions}
          adapt={{ objectType: "purchase_order", objectLabel: "Purchase Order", isAdmin }}
          remove={isDraft ? { endpoint: `/api/purchase-orders/${po.id}`, recordName: po.ref, entityLabel: "draft purchase order", afterHref: ROUTES.purchaseOrders } : undefined}
        />
      }
      facts={[
        { label: "Supplier", value: supplier ? <Link href={ROUTES.supplier(supplier.id)} style={{ color: c.accent, textDecoration: "none" }}>{supplier.name}</Link> : "—" },
        { label: "Order date", value: po.order_date ? fmtDate(po.order_date) : "—" },
        { label: "Expected", value: po.expected_date ? fmtDate(po.expected_date) : "—" },
        { label: "Total", value: inr(po.total) },
      ]}
      externalLine={<ExternalRecordSlot objectType="purchase_orders" objectId={id} />}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <ObjectSections
              objectType="purchase_order"
              record={po as unknown as Record<string, unknown>}
              patchUrl={`/api/purchase-orders/${po.id}`}
              exclude={["ref"]}
            />
          ),
        },
        {
          id: "lines",
          label: "Lines",
          count: lines.length,
          content: (
            <>
              {canReceive && <ReceivePanel poId={po.id} lines={lines} />}
              <RelatedList
                title="Line items"
                emptyText="No line items."
                rows={lines}
                rowKey={(l) => l.id}
                columns={[
                  { label: "Description", render: (l) => l.description },
                  { label: "UOM", align: "center", cellStyle: { color: c.muted, fontSize: 12.5 }, render: (l) => l.uom ?? "" },
                  { label: "Ordered", align: "right", render: (l) => l.qty_ordered },
                  {
                    label: "Received", align: "right",
                    render: (l) => (
                      <span style={{ color: l.qty_received >= l.qty_ordered ? "var(--teal)" : c.muted, fontWeight: l.qty_received >= l.qty_ordered ? 600 : 400 }}>{l.qty_received}</span>
                    ),
                  },
                  { label: "Rate", align: "right", cellStyle: { color: c.muted }, render: (l) => inr(l.rate) },
                  { label: "Amount", align: "right", cellStyle: { fontWeight: 500 }, render: (l) => inr(l.amount) },
                ]}
                footer={<div style={{ fontSize: 14, fontWeight: 700 }}>Total: {inr(po.total)}</div>}
              />
            </>
          ),
        },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="purchase_orders" objectId={po.id} isAdmin={isAdmin} /> },
      ]}
      rail={
        <Card padding={14}>
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
        </Card>
      }
    />
  );
}
