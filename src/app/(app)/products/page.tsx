import { requireFeature, getTenantCurrency } from "@/lib/tenant";
import { formatMoney } from "@/lib/currency";
import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Product } from "@/lib/types";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import { getSalesConfig } from "@/lib/fieldConfig";
import { categoryLabel, subCategoryLabel } from "@/lib/picklists";
import { rowsCarrySupplier, supplierNamesById } from "@/lib/products/supplier";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT_EXTRACTORS: Record<string, SortExtractor<Product>> = {
  ref: (p) => p.ref,
  name: (p) => p.name,
  sku: (p) => p.sku,
  category: (p) => p.category,
  sub_category: (p) => p.sub_category,
  uom: (p) => p.uom,
  list_price: (p) => p.list_price,
  status: (p) => p.status,
  created_at: (p) => p.created_at,
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("products");
  await requireFeature("products");
  const cur = await getTenantCurrency();
  const inr = (n: number | null) => (n == null ? "—" : formatMoney(n, cur, { maximumFractionDigits: 2 }));
  const { supabase, tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { q, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const [{ data: rows }, salesConfig] = await Promise.all([
    supabase.from("products").select("*").eq("tenant_id", tenantId).order("name"),
    getSalesConfig(supabase, tenantId),
  ]);
  const products: Product[] = rows ?? [];
  // Preferred supplier (0132): the column only exists once the migration has
  // run -- rows without a supplier_id key mean "not yet", so the column is
  // not drawn at all. Names come from a second tenant-scoped query.
  const supplierOn = rowsCarrySupplier(products);
  const supplierNames = supplierOn ? await supplierNamesById(supabase, tenantId, products.map((p) => p.supplier_id)) : new Map<string, string>();
  const supplierName = (p: Product) => (p.supplier_id ? supplierNames.get(p.supplier_id) ?? "" : "");
  const tree = salesConfig.product_categories;
  // Stored values are codes; the table shows display names (code falls
  // through for values not in the tree, e.g. legacy free-typed ones).
  const catName = (p: Product) => categoryLabel(tree, p.category);
  const subName = (p: Product) => subCategoryLabel(tree, p.sub_category);

  // No per-category chip row here (owner decision 2026-08-22): the list shows
  // everything, and category/sub-category narrowing is the advanced filter's
  // and the column filters' job — a tenant's tree can be far too wide for chips.
  const extractors: Record<string, SortExtractor<Product>> = supplierOn ? { ...SORT_EXTRACTORS, supplier: supplierName } : SORT_EXTRACTORS;
  const searched = products.filter((p) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.sku ?? "").toLowerCase().includes(term) ||
      (p.category ?? "").toLowerCase().includes(term) ||
      catName(p).toLowerCase().includes(term) ||
      (p.sub_category ?? "").toLowerCase().includes(term) ||
      subName(p).toLowerCase().includes(term) ||
      (p.description ?? "").toLowerCase().includes(term) ||
      supplierName(p).toLowerCase().includes(term)
    );
  });
  const advFiltered = applyAdvancedFilter(searched, af, (p) => p as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, extractors);
  const filtered = sortRows(colFiltered, sort, dir, extractors);
  const pageRows = paginate(filtered, page);

  const active = products.filter((p) => p.status === "active").length;
  const hasFilter = !!(q || af || Object.keys(cfParams).length > 0);

  const columns: ListColumn<Product>[] = [
    {
      id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden",
      cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
      render: (p) => p.ref ?? "—",
    },
    {
      id: "name", label: "Name", sortKey: "name", card: "title",
      render: (p) => (
        <>
          <Link href={ROUTES.product(p.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>
            {p.name}
          </Link>
          {p.description && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, fontWeight: 400, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description}</div>}
        </>
      ),
    },
    { id: "sku", label: "SKU", sortKey: "sku", cellStyle: { color: c.muted, fontSize: 12, fontFamily: "monospace" }, render: (p) => p.sku ?? "—" },
    {
      id: "category", label: "Category", sortKey: "category", cellStyle: { color: c.muted, fontSize: 13 },
      render: (p) => (
        <>
          {p.category ? catName(p) : "—"}
          {p.sub_category && <span style={{ color: c.hint }}>{" › "}{subName(p)}</span>}
        </>
      ),
    },
    ...(supplierOn ? [{
      id: "supplier", label: "Supplier", sortKey: "supplier", cellStyle: { color: c.muted, fontSize: 13 },
      render: (p: Product) => p.supplier_id && supplierName(p)
        ? <Link href={ROUTES.supplier(p.supplier_id)} style={{ color: c.accent, textDecoration: "none" }}>{supplierName(p)}</Link>
        : "—",
    } satisfies ListColumn<Product>] : []),
    { id: "uom", label: "UoM", sortKey: "uom", cellStyle: { color: c.muted, fontSize: 13 }, render: (p) => p.uom ?? "—" },
    { id: "list_price", label: "List price", sortKey: "list_price", cellStyle: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }, render: (p) => inr(p.list_price) },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (p) => <StatusPill label={p.status === "active" ? "Active" : "Inactive"} tone={p.status === "active" ? "green" : "red"} />,
    },
  ];

  return (
    <ObjectListPage
      title="Products"
      subtitle={`${products.length} total · ${active} active`}
      newLabel="Product"
      newHref={ROUTES.productNew}
      search={{
        value: q,
        placeholder: "Search by name, SKU, category, supplier or description…",
        hiddenParams: { af, ...cfParams },
      }}
      advancedFilterObject="product"
      columns={columns}
      rows={pageRows}
      rowKey={(p) => p.id}
      rowHref={(p) => ROUTES.product(p.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.products}
      sort={sort}
      dir={dir}
      linkParams={{ q, af, ...cfParams }}
      filtered={hasFilter}
      empty={{
        title: "No products yet",
        text: "Add the items and services you sell, then pick them straight into quotes.",
        filteredTitle: q ? `No products match "${q}".` : "No products match these filters.",
      }}
    />
  );
}
