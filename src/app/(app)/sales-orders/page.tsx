import Link from "next/link";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListChip, type ListColumn } from "@/components/page/ObjectListPage";
import type { MenuItem } from "@/components/ui/menuItems";
import { fmtDate, statusLabel, statusTone } from "@/components/salesOrders/logic";
import { fmtMoney } from "@/components/salesOrders/money";
import { getTenantCurrency } from "@/lib/tenant";
import { loadOrderRows, type OrderListRow } from "./loadOrders";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const STATUS_CHIPS = [["draft", "Draft"], ["confirmed", "Confirmed"], ["cancelled", "Cancelled"]] as const;

const SORT_EXTRACTORS: Record<string, SortExtractor<OrderListRow>> = {
  ref: (o) => o.ref,
  account_name: (o) => o.account_name,
  total: (o) => o.total,
  expected_date: (o) => o.expected_date,
  status: (o) => statusLabel(o),
  created_at: (o) => o.created_at,
};

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; origin?: string; q?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("sales_orders");
  await requireFeature("sales_orders");
  const params = await searchParams;
  const { status: statusFilter, q } = params;
  const originFilter = params.origin === "erp" || params.origin === "bpmsquare" ? params.origin : undefined;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const { supabase, tenantId, role } = await requireTenantUser();
  const [{ rows: all }, currency] = await Promise.all([loadOrderRows(supabase, tenantId), getTenantCurrency()]);

  const needle = (q ?? "").trim().toLowerCase();
  const byOrigin = originFilter ? all.filter((o) => o.origin === originFilter) : all;
  const byStatus = statusFilter ? byOrigin.filter((o) => o.status === statusFilter) : byOrigin;
  const searched = byStatus.filter((o) => !needle || o.ref.toLowerCase().includes(needle) || (o.erp_number ?? "").toLowerCase().includes(needle) || o.account_name.toLowerCase().includes(needle) || (o.customer_po ?? "").toLowerCase().includes(needle));
  const filtered = sortRows(applyColFilters(searched, colFilters, SORT_EXTRACTORS), sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const href = (status?: string, origin?: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (origin) qs.set("origin", origin);
    const t = qs.toString();
    return t ? `${ROUTES.salesOrders}?${t}` : ROUTES.salesOrders;
  };
  const chips: ListChip[] = [
    { id: "all", label: `All (${all.length})`, href: ROUTES.salesOrders, active: !statusFilter && !originFilter },
    ...STATUS_CHIPS.map(([id, label]) => ({
      id, label: `${label} (${byOrigin.filter((o) => o.status === id).length})`, href: href(id, originFilter), active: statusFilter === id,
    })),
    // Origin, only when an ERP has put orders here: the two words mean "made in BPMSquare" and "read from the ERP".
    ...(all.some((o) => o.origin === "erp")
      ? ([["bpmsquare", "BPMSquare"], ["erp", "ERP"]] as const).map(([id, label]) => ({
          id: `origin-${id}`, label: `${label} (${all.filter((o) => o.origin === id).length})`, href: originFilter === id ? href(statusFilter) : href(statusFilter, id), active: originFilter === id,
        }))
      : []),
  ];

  const columns: ListColumn<OrderListRow>[] = [
    {
      id: "ref", label: "Order", sortKey: "ref", card: "title",
      render: (o) => <Link href={ROUTES.salesOrder(o.id)} style={{ fontFamily: MONO, fontSize: 12.5, color: c.accent, fontWeight: 600, textDecoration: "none" }}>{o.ref}</Link>,
    },
    {
      id: "account_name", label: "Customer", sortKey: "account_name",
      render: (o) => (o.customer_not_synced ? <span title="This customer is not in BPMSquare yet">{o.account_name} <span style={{ color: c.muted, fontSize: 11.5 }}>(not synced)</span></span> : o.account_name),
    },
    ...(all.some((o) => o.erp_number) ? [{ id: "erp_number", label: "ERP no.", render: (o: OrderListRow) => <span style={{ fontFamily: MONO, fontSize: 12.5, color: c.muted }}>{o.erp_number ?? "—"}</span> }] : []),
    { id: "total", label: "Total", sortKey: "total", cellStyle: { fontWeight: 700 }, render: (o) => fmtMoney(o.total, o.currency || currency.code, 0) },
    { id: "expected_date", label: "Expected delivery", sortKey: "expected_date", cellStyle: { color: c.muted }, render: (o) => fmtDate(o.expected_date) },
    { id: "status", label: "Status", sortKey: "status", render: (o) => <StatusPill label={statusLabel(o)} tone={statusTone(o)} /> },
  ];

  const menuItems: MenuItem[] = [{ label: "Order types", href: ROUTES.settingsOrderTypes, hidden: role !== "admin" }];

  return (
    <ObjectListPage
      title="Sales Orders"
      subtitle={`${filtered.length}${statusFilter ? ` ${statusFilter}` : ""} of ${all.length} total`}
      newLabel="Sales Order"
      newHref={ROUTES.salesOrderNew}
      menuItems={menuItems}
      chips={chips}
      search={{ value: q, placeholder: "Search order ref, customer or PO…", hiddenParams: { status: statusFilter, origin: originFilter, ...cfParams } }}
      columns={columns}
      rows={pageRows}
      rowKey={(o) => o.id}
      rowHref={(o) => ROUTES.salesOrder(o.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.salesOrders}
      sort={sort}
      dir={dir}
      linkParams={{ status: statusFilter, origin: originFilter, q, ...cfParams }}
      filtered={!!(q || statusFilter || originFilter || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No sales orders yet",
        text: "An order records what a customer bought: create one here, or from an accepted quote.",
        filteredTitle: "No sales orders match these filters.",
      }}
    />
  );
}
