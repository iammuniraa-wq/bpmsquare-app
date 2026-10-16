import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import type { InventoryItem, Supplier } from "@/lib/types";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low_stock?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("inventory");
  await requireFeature("purchasing");
  const { supabase, tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { q, low_stock, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
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
  filtered = applyColFilters(filtered, colFilters, SORT_EXTRACTORS);
  filtered = sortRows(filtered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const lowStockCount = items.filter((i) => i.reorder_level != null && i.qty_on_hand <= i.reorder_level).length;
  const lowParam = low_stock === "true" ? "true" : undefined;

  const chips = [
    { id: "all", label: `All (${items.length})`, href: ROUTES.inventory, active: !low_stock },
    ...(lowStockCount > 0 ? [{ id: "low", label: `Low stock (${lowStockCount})`, href: `${ROUTES.inventory}?low_stock=true`, active: low_stock === "true" }] : []),
  ];

  const columns: ListColumn<InventoryItem>[] = [
    {
      id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden",
      cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
      render: (i) => i.ref ?? "—",
    },
    {
      id: "name", label: "Name", sortKey: "name", card: "title",
      render: (i) => <Link href={ROUTES.inventoryItem(i.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{i.name}</Link>,
    },
    { id: "sku", label: "SKU", sortKey: "sku", cellStyle: { color: c.muted, fontSize: 12, fontFamily: "monospace" }, render: (i) => i.sku ?? "—" },
    { id: "category", label: "Category", sortKey: "category", cellStyle: { color: c.muted, fontSize: 13 }, render: (i) => i.category ?? "—" },
    {
      id: "qty_on_hand", label: "Qty on hand", sortKey: "qty_on_hand",
      render: (i) => {
        const low = i.reorder_level != null && i.qty_on_hand <= i.reorder_level;
        return (
          <>
            <span style={{ fontWeight: 600, color: low ? "var(--red)" : c.ink }}>{i.qty_on_hand}</span>
            <span style={{ color: c.hint, fontSize: 11.5 }}> {i.uom}</span>
            {low && <span style={{ marginLeft: 6 }}><StatusPill label="Low" tone="red" /></span>}
          </>
        );
      },
    },
    { id: "supplier", label: "Supplier", sortKey: "supplier", cellStyle: { color: c.muted, fontSize: 13 }, render: (i) => (i.supplier_id ? (supplierNameById.get(i.supplier_id) ?? "—") : "—") },
    { id: "status", label: "Status", sortKey: "status", render: (i) => <StatusPill label={i.status === "active" ? "Active" : "Inactive"} tone={i.status === "active" ? "green" : "red"} /> },
  ];

  return (
    <ObjectListPage
      title="Inventory"
      subtitle={`${items.length} items · ${lowStockCount} low stock`}
      newLabel="Item"
      newHref={ROUTES.inventoryNew}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search by name, SKU or category…",
        hiddenParams: { low_stock: lowParam, af, ...cfParams },
      }}
      advancedFilterObject="inventory"
      columns={columns}
      rows={pageRows}
      rowKey={(i) => i.id}
      rowHref={(i) => ROUTES.inventoryItem(i.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.inventory}
      sort={sort}
      dir={dir}
      linkParams={{ q, low_stock: lowParam, af, ...cfParams }}
      filtered={!!(q || lowParam || af || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No inventory items yet",
        text: "Add the stock items you buy and use, then track quantity on hand.",
        filteredTitle: q ? `No items match "${q}".` : "No items match these filters.",
      }}
    />
  );
}
