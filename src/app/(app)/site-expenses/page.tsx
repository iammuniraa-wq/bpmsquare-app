import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSitePage } from "@/lib/site/pageGuard";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { listExpenses, loadViewerScope, type ExpenseListRow } from "@/lib/site/expensesServer";
import { openSiteRequest } from "@/lib/site/server";
import { EXPENSE_FLAG_LABEL, EXPENSE_STATUS_LABEL, type ExpenseStatus } from "@/lib/site/types";
import { fmtMoney } from "@/lib/site/clientHelpers";
import { SITE_TIPS } from "@/lib/site/tips";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const tone = (s: ExpenseStatus) => (s === "approved" ? "green" : s === "rejected" ? "red" : s === "cancelled" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";

const SORT: Record<string, SortExtractor<ExpenseListRow>> = {
  ref: (e) => e.ref, project: (e) => e.project_name, person: (e) => e.submitted_by_name, category: (e) => e.category_name, vendor: (e) => e.vendor_text,
  amount: (e) => e.amount, date: (e) => e.expense_date, status: (e) => e.status,
};

const COLUMNS: ListColumn<ExpenseListRow>[] = [
  { id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (e) => e.ref ?? "—" },
  {
    id: "vendor", label: "Expense", sortKey: "vendor", card: "title",
    render: (e) => (
      <>
        <Link href={ROUTES.siteExpense(e.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{e.vendor_text ?? e.category_name ?? "Expense"}</Link>
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{e.project_ref ? `${e.project_ref} · ` : ""}{e.project_name}</div>
      </>
    ),
  },
  { id: "person", label: "Entered by", sortKey: "person", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => e.submitted_by_name ?? "—" },
  { id: "category", label: "Category", sortKey: "category", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => e.category_name ?? "—" },
  { id: "date", label: "Date", sortKey: "date", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (e) => e.expense_date },
  { id: "amount", label: "Amount", sortKey: "amount", cellStyle: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "right" }, render: (e) => fmtMoney(e.amount, e.currency) },
  {
    id: "flags", label: "Flags", info: SITE_TIPS.flags,
    render: (e) => (e.flags.length === 0 ? <span style={{ color: c.hint }}>—</span> : <span style={{ fontSize: 12, color: "var(--amberink)" }}>{e.flags.map((f) => EXPENSE_FLAG_LABEL[f]).join(", ")}</span>),
  },
  { id: "status", label: "Status", sortKey: "status", info: SITE_TIPS.expenseStatus, render: (e) => <StatusPill label={EXPENSE_STATUS_LABEL[e.status]} tone={tone(e.status)} /> },
];

/** Every site expense this person may see: all of them for a cost approver, their own and their projects' for anyone else. Waiting first. */
export default async function SiteExpensesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>> }) {
  await requireSitePage("site_expenses");
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) notFound();
  const req = gate.req;
  const params = await searchParams;
  const { q, status, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const scope = await loadViewerScope(req);
  const { rows: all, pending } = await listExpenses(req, scope, { limit: 1000 });
  if (pending) return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Site expenses need a database update (migration 0258). Ask your administrator to apply it.</div>;

  const count = (s: ExpenseStatus) => all.filter((e) => e.status === s).length;
  const byStatus = status && status !== "all" ? all.filter((e) => e.status === status) : all;
  const term = q?.toLowerCase();
  const searched = byStatus.filter((e) => !term || [e.ref, e.vendor_text, e.category_name, e.project_name, e.submitted_by_name, e.invoice_ref].some((v) => (v ?? "").toLowerCase().includes(term)));
  const adv = applyAdvancedFilter(searched, af, (e) => e as unknown as Record<string, unknown>);
  const filtered = sortRows(applyColFilters(adv, colFilters, SORT), sort, dir, SORT);
  const rows = paginate(filtered, page);

  const href = (s: string) => `${ROUTES.siteExpenses}?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const chips = [
    { id: "all", label: `All (${all.length})` }, { id: "submitted", label: `Waiting (${count("submitted")})` }, { id: "approved", label: `Approved (${count("approved")})` },
    { id: "rejected", label: `Returned (${count("rejected")})` }, { id: "cancelled", label: `Cancelled (${count("cancelled")})` },
  ].map(({ id, label }) => ({ id, label, href: href(id), active: (status ?? "all") === id }));

  return (
    <ObjectListPage
      title="Site expenses"
      subtitle={`${all.length} total · ${count("submitted")} waiting`}
      info={SITE_TIPS.expenseStatus}
      newLabel="expense"
      newHref={ROUTES.siteExpenseNew}
      menuItems={scope.isCost ? [{ label: "Register for finance (Excel)", href: "/api/site-expenses/register", newTab: true }] : []}
      chips={chips}
      search={{ value: q, placeholder: "Search by number, vendor, person or project…", hiddenParams: { status: status && status !== "all" ? status : undefined, af, ...cfParams } }}
      advancedFilterObject="site_expense"
      columns={COLUMNS}
      rows={rows}
      rowKey={(e) => e.id}
      rowHref={(e) => ROUTES.siteExpense(e.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.siteExpenses}
      sort={sort}
      dir={dir}
      linkParams={{ q, status, af, ...cfParams }}
      filtered={!!(q || af || (status && status !== "all") || Object.keys(cfParams).length > 0)}
      empty={{ title: "No site expenses yet", text: "A person on site adds one from a phone: photo, category, Submit.", filteredTitle: q ? `No expenses match "${q}".` : "No expenses match these filters." }}
    />
  );
}
