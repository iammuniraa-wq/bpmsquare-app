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
  searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("sales_orders");
  await requireFeature("sales_orders");
  const params = await searchParams;
  const { status: statusFilter, q } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const { supabase, tenantId, role } = await requireTenantUser();
  const [{ rows: all }, currency] = await Promise.all([loadOrderRows(supabase, tenantId), getTenantCurrency()]);

  const needle = (q ?? "").trim().toLowerCase();
  const byStatus = statusFilter ? all.filter((o) => o.status === statusFilter) : all;
  const searched = byStatus.filter((o) => !needle || o.ref.toLowerCase().includes(needle) || o.account_name.toLowerCase().includes(needle) || (o.customer_po ?? "").toLowerCase().includes(needle));
  const filtered = sortRows(applyColFilters(searched, colFilters, SORT_EXTRACTORS), sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const chips: ListChip[] = [
    { id: "all", label: `All (${all.length})`, href: ROUTES.salesOrders, active: !statusFilter },
    ...STATUS_CHIPS.map(([id, label]) => ({
      id, label: `${label} (${all.filter((o) => o.status === id).length})`, href: `${ROUTES.salesOrders}?status=${id}`, active: statusFilter === id,
    })),
  ];

  const columns: ListColumn<OrderListRow>[] = [
    {
      id: "ref", label: "Order", sortKey: "ref", card: "title",
      render: (o) => <Link href={ROUTES.salesOrder(o.id)} style={{ fontFamily: MONO, fontSize: 12.5, color: c.accent, fontWeight: 600, textDecoration: "none" }}>{o.ref}</Link>,
    },
    { id: "account_name", label: "Customer", sortKey: "account_name", render: (o) => o.account_name },
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
      search={{ value: q, placeholder: "Search order ref, customer or PO…", hiddenParams: { status: statusFilter, ...cfParams } }}
      columns={columns}
      rows={pageRows}
      rowKey={(o) => o.id}
      rowHref={(o) => ROUTES.salesOrder(o.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.salesOrders}
      sort={sort}
      dir={dir}
      linkParams={{ status: statusFilter, q, ...cfParams }}
      filtered={!!(q || statusFilter || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No sales orders yet",
        text: "An order records what a customer bought: create one here, or from an accepted quote.",
        filteredTitle: "No sales orders match these filters.",
      }}
    />
  );
}
