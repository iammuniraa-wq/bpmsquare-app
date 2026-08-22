import { requireFeature } from "@/lib/tenant";
import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Product } from "@/lib/types";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Pill from "@/components/Pill";
import ListFilterBar from "@/components/ListFilterBar";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import SortableTh from "@/components/SortableTh";
import PagerLink from "@/components/PagerLink";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import { getSalesConfig } from "@/lib/fieldConfig";
import { categoryLabel, subCategoryLabel } from "@/lib/picklists";

const inr = (n: number | null) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

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
  const tree = salesConfig.product_categories;
  // Stored values are codes; the table shows display names (code falls
  // through for values not in the tree, e.g. legacy free-typed ones).
  const catName = (p: Product) => categoryLabel(tree, p.category);
  const subName = (p: Product) => subCategoryLabel(tree, p.sub_category);

  // No per-category chip row here (owner decision 2026-08-22): the list shows
  // everything, and category/sub-category narrowing is the advanced filter's
  // and the column filters' job — a tenant's tree can be far too wide for chips.
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
      (p.description ?? "").toLowerCase().includes(term)
    );
  });
  const advFiltered = applyAdvancedFilter(searched, af, (p) => p as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const active = products.filter((p) => p.status === "active").length;

  return (
    <>
      <TabTitle title="Products" />
      <PageHeader
        title="Products"
        subtitle={`${products.length} total · ${active} active`}
        action={
          <Link
            href={ROUTES.productNew}
            style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + Add Product
          </Link>
        }
      />

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search by name, SKU, category or description…"
        hiddenParams={{ af, ...cfParams }}
        clearHref={ROUTES.products}
      />
      <AdvancedFilterPanel object="product" />

      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            {q ? `No products match "${q}".` : "No products yet."}
            {!q && (
              <div style={{ marginTop: 12 }}>
                <Link href={ROUTES.productNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                  + Add your first product
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
                    const hp = { q, af, ...cfParams };
                    return (
                      <>
                        <SortableTh label="ID" sortKey="ref" searchId="ref" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={{ ...th, width: 88 }} />
                        <SortableTh label="Name" sortKey="name" searchId="name" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={th} />
                        <SortableTh label="SKU" sortKey="sku" searchId="sku" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={th} />
                        <SortableTh label="Category" sortKey="category" searchId="category" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={th} />
                        <SortableTh label="UoM" sortKey="uom" searchId="uom" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={th} />
                        <SortableTh label="List price" sortKey="list_price" searchId="list_price" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={th} />
                        <SortableTh label="Status" sortKey="status" searchId="status" currentSort={sort} currentDir={dir} baseHref={ROUTES.products} hiddenParams={hp} style={th} />
                      </>
                    );
                  })()}
                  <th style={{ ...th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }}>{p.ref ?? "—"}</td>
                    <td style={td}>
                      <Link href={ROUTES.product(p.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>
                        {p.name}
                      </Link>
                      {p.description && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description}</div>}
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 12, fontFamily: "monospace" }}>{p.sku ?? "—"}</td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>
                      {p.category ? catName(p) : "—"}
                      {p.sub_category && <span style={{ color: c.hint }}>{" › "}{subName(p)}</span>}
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 13 }}>{p.uom ?? "—"}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{inr(p.list_price)}</td>
                    <td style={td}>
                      <Pill label={p.status === "active" ? "Active" : "Inactive"} tone={p.status === "active" ? "green" : "red"} />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Link href={ROUTES.product(p.id)} style={{
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
            <PagerLink
              page={page}
              total={filtered.length}
              pageSize={DEFAULT_PAGE_SIZE}
              baseHref={ROUTES.products}
              hiddenParams={{ q, sort, dir, af, ...cfParams }}
            />
          </div>
        )}
      </div>
    </>
  );
}
