import Link from "next/link";
import { requireFeature, getTenantCurrency, getTenant } from "@/lib/tenant";
import { einvoicingOn } from "@/lib/einvoicing/gate";
import { DOC_CHIP } from "@/lib/einvoicing/labels";
import { ledgerSign } from "@/lib/einvoicing/creditNote";
import { moneyFormatter } from "@/lib/currency";
import { requireWorkcenterView } from "@/lib/permissions";
import { listInvoices, type InvoiceRow } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import type { InvoiceStatus } from "@/lib/types";

const STATUS_TONE: Record<InvoiceStatus, PillarKey> = {
  draft: "blue", sent: "amber", partial: "purple", paid: "green", overdue: "red", cancelled: "red",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", partial: "Partial", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};
const SUMMARY_STATUSES: InvoiceStatus[] = ["draft", "sent", "partial", "paid", "overdue"];

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const SORT_EXTRACTORS: Record<string, SortExtractor<InvoiceRow>> = {
  ref: (i) => i.ref,
  account: (i) => i.account_name,
  status: (i) => i.status,
  total: (i) => i.total,
  balance: (i) => Math.max(0, i.total - i.paid_amount),
  issued: (i) => i.issued_at,
  type: (i) => i.einvoice_doc_type ?? "",
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; from?: string; to?: string; sort?: string; dir?: string; page?: string; af?: string; type?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("invoices");
  await requireFeature("invoices");
  const inr = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });
  const params = await searchParams;
  const { status: statusFilter, q, from, to, af } = params;
  // Saudi e-invoicing workspaces get a type chip on every row and a "Credit notes" filter. Nobody else sees either.
  const tenant = await getTenant();
  const einv = !!tenant && einvoicingOn(tenant.features, tenant.config);
  const typeFilter = einv && params.type === "credit_note" ? "credit_note" : undefined;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const invoices = await listInvoices();

  // A credit note is stored with positive amounts and counts against the money billed (ledgerSign); without e-invoicing every sign is +1.
  const sign = (i: InvoiceRow) => (einv ? ledgerSign(i.einvoice_doc_type) : 1);
  const summary = SUMMARY_STATUSES.map((s) => ({
    status: s,
    count: invoices.filter((i) => i.status === s).length,
    total: invoices.filter((i) => i.status === s).reduce((acc, i) => acc + sign(i) * i.total, 0),
  }));

  // Summary tiles deliberately count the WHOLE ledger, not the filtered
  // subset -- they're the overview the filters act on, and a tile showing
  // the total of what you already filtered to is useless.
  const needle = (q ?? "").trim().toLowerCase();
  const searched = invoices.filter((i) => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (typeFilter && i.einvoice_doc_type !== typeFilter) return false;
    // Date bounds compare on the issue date; an unissued (draft) invoice has
    // no date and so can't satisfy a range.
    const issued = i.issued_at ? i.issued_at.slice(0, 10) : null;
    if (from && (!issued || issued < from)) return false;
    if (to && (!issued || issued > to)) return false;
    if (!needle) return true;
    return (
      (i.ref ?? "").toLowerCase().includes(needle) ||
      (i.account_name ?? "").toLowerCase().includes(needle)
    );
  });
  const advFiltered = applyAdvancedFilter(searched, af, (i) => i as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const columns: ListColumn<InvoiceRow>[] = [
    {
      id: "ref", label: "Ref", sortKey: "ref", card: "title",
      render: (inv) => (
        <Link href={ROUTES.invoice(inv.id)} style={{ fontFamily: MONO, fontSize: 12.5, color: c.accent, fontWeight: 600, textDecoration: "none" }}>{inv.ref}</Link>
      ),
    },
    { id: "account", label: "Account", sortKey: "account", render: (inv) => inv.account_name },
    ...(einv ? [{
      id: "type", label: "Type", sortKey: "type",
      render: (inv: InvoiceRow) => inv.einvoice_doc_type
        ? <StatusPill label={DOC_CHIP[inv.einvoice_doc_type]} tone={inv.einvoice_doc_type === "credit_note" || inv.einvoice_doc_type === "debit_note" ? "purple" : "blue"} />
        : <span style={{ color: c.hint }}>—</span>,
    }] : []),
    {
      id: "status", label: "Status", sortKey: "status",
      render: (inv) => <StatusPill label={STATUS_LABEL[inv.status as InvoiceStatus] ?? inv.status} tone={STATUS_TONE[inv.status as InvoiceStatus] ?? "blue"} />,
    },
    { id: "total", label: "Total", sortKey: "total", cellStyle: { fontWeight: 700 }, render: (inv) => inr(inv.total) },
    {
      id: "balance", label: "Balance due", sortKey: "balance",
      render: (inv) => {
        const due = inv.total - inv.paid_amount > 0;
        return <span style={{ color: due ? "var(--red)" : c.muted, fontWeight: due ? 600 : 400 }}>{inr(Math.max(0, inv.total - inv.paid_amount))}</span>;
      },
    },
    { id: "issued", label: "Issued", sortKey: "issued", cellStyle: { color: c.muted }, render: (inv) => (inv.issued_at ? fmtDate(inv.issued_at) : "—") },
  ];

  const typeChips = einv ? (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }} data-guide="invoices.type_filter">
      {[{ id: undefined, label: "All" }, { id: "credit_note", label: "Credit notes" }].map((t) => {
        const on = typeFilter === t.id;
        const href = `${ROUTES.invoices}${t.id ? `?type=${t.id}` : ""}`;
        return (
          <Link key={t.label} href={href} aria-current={on ? "true" : undefined} style={{ textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, border: `1px solid ${on ? c.accent : c.line}`, color: on ? c.accent : c.muted, background: on ? c.accentbg : "transparent" }}>
            {t.label}
          </Link>
        );
      })}
    </div>
  ) : null;

  const summaryTiles = (
    <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
      {summary.map(({ status, count, total }) => (
        <Link key={status} href={statusFilter === status ? ROUTES.invoices : `${ROUTES.invoices}?status=${status}`} style={{ textDecoration: "none" }}>
          <div style={{ ...CARD_SURFACE, padding: 14, textAlign: "center", borderColor: statusFilter === status ? pillar[STATUS_TONE[status]].base : undefined }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              {STATUS_LABEL[status]}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: pillar[STATUS_TONE[status]].base }}>{inr(total)}</div>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>{count} invoice{count !== 1 ? "s" : ""}</div>
          </div>
        </Link>
      ))}
    </div>
  );

  const hasFilter = !!(q || af || from || to || statusFilter || typeFilter || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Invoices"
      subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as InvoiceStatus] ?? statusFilter}` : ""} of ${invoices.length} total · Finance & billing`}
      newLabel="Invoice"
      newHref={ROUTES.invoiceNew}
      search={{
        value: q,
        placeholder: "Search invoice ref or account…",
        dates: [{ name: "from", value: from, label: "Issued from" }, { name: "to", value: to, label: "to" }],
        hiddenParams: { status: statusFilter, af, type: typeFilter, ...cfParams },
      }}
      advancedFilterObject="invoice"
      beforeTable={<>{typeChips}{summaryTiles}</>}
      columns={columns}
      rows={pageRows}
      rowKey={(inv) => inv.id}
      rowHref={(inv) => ROUTES.invoice(inv.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.invoices}
      sort={sort}
      dir={dir}
      linkParams={{ status: statusFilter, q, from, to, af, type: typeFilter, ...cfParams }}
      filtered={hasFilter}
      empty={{
        title: "No invoices yet",
        text: "Create one, or raise one from a completed work order or an approved quote.",
        filteredTitle: "No invoices match these filters.",
      }}
    />
  );
}
