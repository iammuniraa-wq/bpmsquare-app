import Link from "next/link";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature, getTenantCurrency } from "@/lib/tenant";
import { moneyFormatter } from "@/lib/currency";
import { listStandardQuotes } from "@/lib/data/live";
import type { StandardQuoteRow } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import type { MenuItem } from "@/components/ui/menuItems";
import { paginate } from "@/lib/paginate";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import type { StandardQuoteStatus } from "@/lib/types";

const STATUS_TONE: Record<StandardQuoteStatus, PillarKey> = {
  draft: "blue", sent: "amber", accepted: "green", rejected: "red", expired: "red",
};
const STATUS_LABEL: Record<StandardQuoteStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired",
};
const SUMMARY_STATUSES: StandardQuoteStatus[] = ["draft", "sent", "accepted", "rejected"];

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const SORT_EXTRACTORS: Record<string, SortExtractor<StandardQuoteRow>> = {
  ref: (q) => q.ref,
  account_name: (q) => q.account_name,
  status: (q) => q.status,
  total: (q) => q.total,
  valid_until: (q) => q.valid_until,
  created_at: (q) => q.created_at,
};

export default async function StandardQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; af?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("standard_quotes");
  await requireFeature("standard_quotes");
  const inr = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });
  const params = await searchParams;
  const { status: statusFilter, q, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const [quotes, { role }] = await Promise.all([listStandardQuotes(), requireTenantUser()]);

  const summary = SUMMARY_STATUSES.map((s) => ({
    status: s,
    count: quotes.filter((q) => q.status === s).length,
    total: quotes.filter((q) => q.status === s).reduce((acc, q) => acc + q.total, 0),
  }));

  const needle = (q ?? "").trim().toLowerCase();
  const statusFiltered = statusFilter ? quotes.filter((quote) => quote.status === statusFilter) : quotes;
  const searched = statusFiltered.filter((quote) => {
    if (!needle) return true;
    return (
      (quote.ref ?? "").toLowerCase().includes(needle) ||
      (quote.account_name ?? "").toLowerCase().includes(needle)
    );
  });
  // Advanced filter (the saved-query panel): standard columns and the tenant's own custom fields.
  const advFiltered = applyAdvancedFilter(searched, af, (qt) => qt as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const columns: ListColumn<StandardQuoteRow>[] = [
    {
      id: "ref", label: "Ref", sortKey: "ref", card: "title",
      render: (qt) => <Link href={ROUTES.standardQuote(qt.id)} style={{ fontFamily: MONO, fontSize: 12.5, color: c.accent, fontWeight: 600, textDecoration: "none" }}>{qt.ref}</Link>,
    },
    { id: "account_name", label: "Account", sortKey: "account_name", render: (qt) => qt.account_name },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (qt) => <StatusPill label={STATUS_LABEL[qt.status as StandardQuoteStatus] ?? qt.status} tone={STATUS_TONE[qt.status as StandardQuoteStatus] ?? "blue"} />,
    },
    { id: "total", label: "Total", sortKey: "total", cellStyle: { fontWeight: 700 }, render: (qt) => inr(qt.total) },
    { id: "valid_until", label: "Valid until", sortKey: "valid_until", cellStyle: { color: c.muted }, render: (qt) => (qt.valid_until ? fmtDate(qt.valid_until) : "—") },
    { id: "created_at", label: "Created", sortKey: "created_at", cellStyle: { color: c.muted }, render: (qt) => fmtDate(qt.created_at) },
  ];

  const summaryTiles = (
    <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
      {summary.map(({ status, count, total }) => (
        <Link key={status} href={statusFilter === status ? ROUTES.standardQuotes : `${ROUTES.standardQuotes}?status=${status}`} style={{ textDecoration: "none" }}>
          <div style={{ ...CARD_SURFACE, padding: 14, textAlign: "center", borderColor: statusFilter === status ? pillar[STATUS_TONE[status]].base : undefined }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              {STATUS_LABEL[status]}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: pillar[STATUS_TONE[status]].base }}>{inr(total)}</div>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>{count} quote{count !== 1 ? "s" : ""}</div>
          </div>
        </Link>
      ))}
    </div>
  );

  const menuItems: MenuItem[] = [
    { label: "Manage Templates", href: ROUTES.standardQuoteTemplates, hidden: role !== "admin" },
  ];

  return (
    <ObjectListPage
      title="Standard Quotes"
      subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as StandardQuoteStatus] ?? statusFilter}` : ""} of ${quotes.length} total`}
      newLabel="Standard Quote"
      newHref={ROUTES.standardQuoteNew}
      menuItems={menuItems}
      search={{
        value: q,
        placeholder: "Search quote ref or account…",
        hiddenParams: { status: statusFilter, af, ...cfParams },
      }}
      advancedFilterObject="standard_quote"
      beforeTable={summaryTiles}
      columns={columns}
      rows={pageRows}
      rowKey={(qt) => qt.id}
      rowHref={(qt) => ROUTES.standardQuote(qt.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.standardQuotes}
      sort={sort}
      dir={dir}
      linkParams={{ status: statusFilter, q, af, ...cfParams }}
      filtered={!!(q || af || statusFilter || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No standard quotes yet",
        text: "A plain quote for an account: line items, discount, tax and shipping.",
        filteredTitle: "No standard quotes match these filters.",
      }}
    />
  );
}
