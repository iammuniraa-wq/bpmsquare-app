import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature, getUserRole, getTenantCurrency } from "@/lib/tenant";
import { formatMoney } from "@/lib/currency";
import { getInventoryLive } from "@/lib/data/live";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { ROUTES } from "@/lib/constants";
import ObjectSections from "@/components/fields/ObjectSections";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import InventorySupplierPanel from "./InventorySupplierPanel";
import AdjustStockPanel from "./AdjustStockPanel";

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 5 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

export default async function InventoryDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireFeature("purchasing");
  const { id } = await params;
  const { tab } = await searchParams;
  const [data, role, cur] = await Promise.all([getInventoryLive(id), getUserRole(), getTenantCurrency()]);
  if (!data) notFound();
  const { item, supplier, transactions } = data;
  const isAdmin = role === "admin";
  const basePath = ROUTES.inventoryItem(item.id);

  const low = item.reorder_level != null && item.qty_on_hand <= item.reorder_level;

  return (
    <ObjectRecordPage
      backHref={ROUTES.inventory}
      backLabel="All inventory"
      title={item.name}
      reference={item.ref}
      meta={`${item.sku ? `SKU ${item.sku} · ` : ""}${item.category ?? "Uncategorised"}`}
      status={
        <>
          <StatusPill label={item.status === "active" ? "Active" : "Inactive"} tone={item.status === "active" ? "green" : "red"} />
          {low && <StatusPill label="Low stock" tone="red" />}
        </>
      }
      primaryAction={<Button href={`${basePath}?tab=stock`} variant="primary">Adjust stock</Button>}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          adapt={{ objectType: "inventory", objectLabel: "Inventory Item", isAdmin }}
          remove={{
            endpoint: `/api/inventory/${item.id}`,
            recordName: item.name,
            entityLabel: "item",
            afterHref: ROUTES.inventory,
          }}
        />
      }
      facts={[
        { label: "On hand", value: <span style={{ color: low ? "var(--red)" : undefined }}>{item.qty_on_hand} {item.uom}</span> },
        ...(item.reorder_level != null ? [{ label: "Reorder level", value: `${item.reorder_level} ${item.uom}` }] : []),
        ...(item.unit_cost != null ? [{ label: "Unit cost", value: formatMoney(item.unit_cost, cur, {}) }] : []),
        { label: "Supplier", value: supplier ? <Link href={ROUTES.supplier(supplier.id)} style={{ color: c.accent, textDecoration: "none" }}>{supplier.name}</Link> : "None set" },
      ]}
      externalLine={<ExternalRecordSlot objectType="inventory_items" objectId={id} />}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <ObjectSections
              objectType="inventory"
              record={item as unknown as Record<string, unknown>}
              patchUrl={`/api/inventory/${item.id}`}
              exclude={["name", "sku", "category", "reorder_level", "unit_cost"]}
            />
          ),
        },
        {
          id: "stock",
          label: "Stock",
          count: transactions.length,
          content: (
            <>
              <AdjustStockPanel itemId={item.id} uom={item.uom} />
              <Card title="Recent stock movements">
                {transactions.length === 0 ? (
                  <EmptyState title="No movements yet" />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {transactions.map((t) => (
                      <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
                        <div>
                          <span style={{ fontWeight: 600, color: t.qty_delta > 0 ? "var(--teal)" : "var(--red)" }}>
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
              </Card>
            </>
          ),
        },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="inventory" objectId={item.id} isAdmin={isAdmin} /> },
      ]}
      rail={
        <>
          <Card title="Details" padding={14}>
            <CtxRow label="Added" value={new Date(item.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />
          </Card>
          <InventorySupplierPanel item={item} />
        </>
      }
    />
  );
}
