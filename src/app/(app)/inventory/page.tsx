import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import type { InventoryItem, Supplier } from "@/lib/types";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ListFilterBar from "@/components/ListFilterBar";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import SortableTh from "@/components/SortableTh";
import PagerLink from "@/components/PagerLink";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { sortRows, readSortParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low_stock?: string; sort?: string; dir?: string; page?: string; af?: string }>;
}) {
  await requireWorkcenterView("inventory");
  await requireFeature("purchasing");
  const { supabase, tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { q, low_stock, af } = params;
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const [{ data: itemRows }, { data: supplierRows }] = await Promise.all([
    supabase.from("inventory_items").select("*").eq("tenant_id", tenantId).order("name"),
    supabase.from("suppliers").select("id, name").eq("tenant_id", tenantId),
  ]);
  const items: InventoryItem[] = itemRows ?? [];
  const supplierNameById = new Map(((supplierRows ?? []) as Pick<Supplier, "id" | "name">[]).map((s) => [s.id, s.name]));

  const SORT_EXTRACTORS: Record<string, SortExtractor<InventoryItem>> = {
    ref: (i) => i.ref,
    name: (i) => i.name,
    sku: (i) => i.sku,
    category: (i) => i.category,
    qty_on_hand: (i) => i.qty_on_hand,
    supplier: (i) => (i.supplier_id ? supplierNameById.get(i.supplier_id) : undefined),
    status: (i) => i.status,
  };

  let filtered = items;
  if (q) {
    const term = q.toLowerCase();
    filtered = filtered.filter((i) =>
      i.name.toLowerCase().includes(term) ||
      (i.sku ?? "").toLowerCase().includes(term) ||
      (i.category ?? "").toLowerCase().includes(term)
    );
  }
  if (low_stock === "true") {
    filtered = filtered.filter((i) => i.reorder_level != null && i.qty_on_hand <= i.reorder_level);
  }
  filtered = applyAdvancedFilter(filtered, af, (i) => i as unknown as Record<string, unknown>);
  filtered = sortRows(filtered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const lowStockCount = items.filter((i) => i.reorder_level != null && i.qty_on_hand <= i.reorder_level).length;

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={`${items.length} items · ${lowStockCount} low stock`}
        action={
          <Link
            href={ROUTES.inventoryNew}
            style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + Add Item
          </Link>
        }
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Link href={ROUTES.inventory} style={{
          fontSize: 12.5, fontWeight: !low_stock ? 700 : 500,
          color: !low_stock ? c.accent : c.muted,
          background: !low_stock ? c.accentbg : c.panel2,
          border: `1px solid ${!low_stock ? c.accent + "60" : c.line}`,
          borderRadius: 6, padding: "5px 12px", textDecoration: "none",
        }}>
          All ({items.length})
        </Link>
        {lowStockCount > 0 && (
          <Link href={`${ROUTES.inventory}?low_stock=true`} style={{
            fontSize: 12.5, fontWeight: low_stock === "true" ? 700 : 500,
            color: low_stock === "true" ? "var(--red)" : c.muted,
            background: low_stock === "true" ? "var(--err-bg)" : c.panel2,
            border: `1px solid ${low_stock === "true" ? "#f5c0c0" : c.line}`,
            borderRadius: 6, padding: "5px 12px", textDecoration: "none",
          }}>
            Low stock ({lowStockCount})
          </Link>
        )}
      </div>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search by name, SKU or category…"
        hiddenParams={{ low_stock: low_stock === "true" ? "true" : undefined, af }}
        clearHref={ROUTES.inventory}
      />
      <AdvancedFilterPanel object="inventory" />

      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            {q ? `No items match "${q}".` : "No inventory items yet."}
            {!q && (
              <div style={{ marginTop: 12 }}>
                <Link href={ROUTES.inventoryNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                  + Add your first item
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                  {(() => {
                    const hp = { q, low_stock: low_stock === "true" ? "true" : undefined };
                    return (
                      <>
                        <SortableTh label="ID" sortKey="ref" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={{ ...th, width: 88 }} />
                        <SortableTh label="Name" sortKey="name" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={th} />
                        <SortableTh label="SKU" sortKey="sku" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={th} />
                        <SortableTh label="Category" sortKey="category" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={th} />
                        <SortableTh label="Qty on hand" sortKey="qty_on_hand" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={th} />
                        <SortableTh label="Supplier" sortKey="supplier" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={th} />
                        <SortableTh label="Status" sortKey="status" currentSort={sort} currentDir={dir} baseHref={ROUTES.inventory} hiddenParams={hp} style={th} />
                      </>
                    );
                  })()}
                  <th style={{ ...th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((i) => {
                  const low = i.reorder_level != null && i.qty_on_hand <= i.reorder_level;
                  return (
                    <tr key={i.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                      <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }}>{i.ref ?? "—"}</td>
                      <td style={td}>
                        <Link href={ROUTES.inventoryItem(i.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>
                          {i.name}
                        </Link>
                      </td>
                      <td style={{ ...td, color: c.muted, fontSize: 12, fontFamily: "monospace" }}>{i.sku ?? "—"}</td>
                      <td style={{ ...td, color: c.muted, fontSize: 13 }}>{i.category ?? "—"}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 600, color: low ? "var(--red)" : c.ink }}>{i.qty_on_hand}</span>
                        <span style={{ color: c.hint, fontSize: 11.5 }}> {i.uom}</span>
                        {low && <span style={{ marginLeft: 6 }}><Pill label="Low" tone="red" /></span>}
                      </td>
                      <td style={{ ...td, color: c.muted, fontSize: 13 }}>{i.supplier_id ? (supplierNameById.get(i.supplier_id) ?? "—") : "—"}</td>
                      <td style={td}>
                        <Pill label={i.status === "active" ? "Active" : "Inactive"} tone={i.status === "active" ? "green" : "red"} />
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Link href={ROUTES.inventoryItem(i.id)} style={{
                          fontSize: 11.5, fontWeight: 600, color: c.accent,
                          background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                          textDecoration: "none", whiteSpace: "nowrap",
                        }}>
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <PagerLink
              page={page}
              total={filtered.length}
              pageSize={DEFAULT_PAGE_SIZE}
              baseHref={ROUTES.inventory}
              hiddenParams={{ q, low_stock: low_stock === "true" ? "true" : undefined, sort, dir, af }}
            />
          </div>
        )}
      </div>
    </>
  );
}
