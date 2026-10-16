import Link from "next/link";
import { requireFeature, getTenantCurrency } from "@/lib/tenant";
import { moneyFormatter } from "@/lib/currency";
import { requireWorkcenterView } from "@/lib/permissions";
import { listPurchaseOrdersLive, type PurchaseOrderRow } from "@/lib/data/live";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
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

const SORT_EXTRACTORS: Record<string, SortExtractor<PurchaseOrderRow>> = {
  ref: (r) => r.po.ref,
  supplier: (r) => r.supplier?.name,
  status: (r) => r.po.status,
  order_date: (r) => r.po.order_date,
  total: (r) => r.po.total,
};

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("purchase_orders");
  await requireFeature("purchasing");
  const inr = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });
  const params = await searchParams;
  const { status: statusFilter, q, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const rows = await listPurchaseOrdersLive();

  const statusFiltered = statusFilter && statusFilter !== "all" ? rows.filter((r) => r.po.status === statusFilter) : rows;
  const searched = statusFiltered.filter((r) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      r.po.ref.toLowerCase().includes(term) ||
      r.po.id.toLowerCase().includes(term) ||
      (r.supplier?.name ?? "").toLowerCase().includes(term)
    );
  });
  const advFiltered = applyAdvancedFilter(searched, af, (r) => r.po as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.po.status] = (acc[r.po.status] ?? 0) + 1;
    return acc;
  }, {});

  const chips = [
    { id: "all", label: `All (${rows.length})` },
    ...(Object.keys(STATUS_LABEL) as PurchaseOrderStatus[]).map((s) => ({ id: s, label: `${STATUS_LABEL[s]} (${counts[s] ?? 0})` })),
  ].map(({ id, label }) => ({
    id, label, href: `${ROUTES.purchaseOrders}?status=${id}`, active: (statusFilter ?? "all") === id,
  }));

  const statusParam = statusFilter && statusFilter !== "all" ? statusFilter : undefined;

  const columns: ListColumn<PurchaseOrderRow>[] = [
    {
      id: "ref", label: "PO ID", sortKey: "ref", card: "title",
      render: ({ po }) => (
        <Link href={ROUTES.purchaseOrder(po.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5, fontFamily: "monospace" }}>{po.ref}</Link>
      ),
    },
    { id: "supplier", label: "Supplier", sortKey: "supplier", cellStyle: { color: c.muted, fontSize: 13 }, render: ({ supplier }) => supplier?.name ?? "—" },
    { id: "status", label: "Status", sortKey: "status", render: ({ po }) => <StatusPill label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} /> },
    { id: "order_date", label: "Order date", sortKey: "order_date", cellStyle: { color: c.hint, fontSize: 12, whiteSpace: "nowrap" }, render: ({ po }) => (po.order_date ? fmtDate(po.order_date) : "—") },
    { id: "total", label: "Total", sortKey: "total", cellStyle: { fontWeight: 600 }, render: ({ po }) => inr(po.total) },
  ];

  const hasFilter = !!(q || af || statusParam || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Purchase Orders"
      subtitle={`Procurement · ${rows.length} orders`}
      newLabel="Purchase Order"
      newHref={ROUTES.purchaseOrderNew}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search PO ID or supplier…",
        hiddenParams: { status: statusParam, af, ...cfParams },
      }}
      advancedFilterObject="purchase_order"
      columns={columns}
      rows={pageRows}
      rowKey={({ po }) => po.id}
      rowHref={({ po }) => ROUTES.purchaseOrder(po.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.purchaseOrders}
      sort={sort}
      dir={dir}
      linkParams={{ status: statusParam, q, af, ...cfParams }}
      filtered={hasFilter}
      empty={{
        title: "No purchase orders yet",
        text: "Order stock from a supplier, then record what arrives.",
        filteredTitle: statusParam ? `No purchase orders with status "${STATUS_LABEL[statusParam as PurchaseOrderStatus] ?? statusParam}".` : "No purchase orders match these filters.",
      }}
    />
  );
}
