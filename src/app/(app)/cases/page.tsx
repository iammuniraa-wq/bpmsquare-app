import { requireFeature } from "@/lib/tenant";
import Link from "next/link";
import { listCases } from "@/lib/data";
import type { CaseSummary } from "@/lib/data";
import type { ServiceCase } from "@/lib/types";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/constants";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { optionalColumnsMenu, parseOptionalCols, type OptionalColumn } from "@/components/page/optionalColumns";
import CaseBoardSlot from "@/components/CaseBoardSlot";
import { ROUTES } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";

const OPEN_STATUSES: ServiceCase["status"][] = [
  "intake","inspection","report_sent","report_approved",
  "quote_sent","quote_approved","in_repair","qa","ready",
];

type FilterKey = "open" | "in_repair" | "awaiting" | "closed" | "all";

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: "open",      label: "Open"      },
  { id: "in_repair", label: "In repair" },
  { id: "awaiting",  label: "Awaiting"  },
  { id: "closed",    label: "Closed"    },
  { id: "all",       label: "All"       },
];

const statusTone: Record<ServiceCase["status"], PillarKey> = {
  intake: "blue", inspection: "blue",
  report_sent: "purple", report_approved: "purple",
  quote_sent: "amber", quote_approved: "amber",
  in_repair: "teal", qa: "teal", ready: "green",
  closed: "green", buyback: "purple", scrapped: "red",
};

const typeTone: Record<ServiceCase["type"], PillarKey> = {
  amc: "teal", adhoc: "amber", direct: "blue",
};

const SORT_EXTRACTORS: Record<string, SortExtractor<CaseSummary>> = {
  ref: (r) => r.serviceCase.ref,
  stage: (r) => r.serviceCase.status,
  account: (r) => r.account.name,
  type: (r) => r.serviceCase.type,
  technician: (r) => r.technicianName,
  intake: (r) => r.serviceCase.intake_at,
  complaint: (r) => r.serviceCase.complaint,
};

// Off until asked for (the old in-table "Columns" picker's default).
const OPTIONAL: OptionalColumn[] = [{ id: "complaint", label: "Complaint" }];

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; af?: string; cols?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("cases");
  await requireFeature("cases");
  const params = await searchParams;
  const { q, filter: rawFilter, af } = params;
  const filter = (FILTERS.find((f) => f.id === rawFilter)?.id) ?? "open";
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const shownOptional = parseOptionalCols(params.cols, OPTIONAL);

  const allCases = await listCases();

  const open     = allCases.filter((r) => OPEN_STATUSES.includes(r.serviceCase.status));
  const inRepair = allCases.filter((r) => r.serviceCase.status === "in_repair");
  const awaiting = allCases.filter((r) => ["report_sent","quote_sent"].includes(r.serviceCase.status));
  const closed   = allCases.filter((r) => ["closed","buyback","scrapped"].includes(r.serviceCase.status));

  const byFilter =
    filter === "open"      ? open
    : filter === "in_repair" ? inRepair
    : filter === "awaiting"  ? awaiting
    : filter === "closed"    ? closed
    : allCases;

  const basicFiltered = byFilter.filter(({ serviceCase: sc, account }) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      sc.ref.toLowerCase().includes(term) ||
      (sc.equipment_label ?? "").toLowerCase().includes(term) ||
      account.name.toLowerCase().includes(term) ||
      (sc.complaint ?? "").toLowerCase().includes(term)
    );
  });

  // `rows` (page filters + search + advanced filter) is what the Nova views
  // get; the classic table adds column filters, sorting and paging on top.
  const rows = applyAdvancedFilter(basicFiltered, af, ({ serviceCase }) => serviceCase as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(rows, colFilters, SORT_EXTRACTORS);
  const sorted = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(sorted, page);

  const counts: Record<FilterKey, number> = {
    open: open.length, in_repair: inRepair.length, awaiting: awaiting.length, closed: closed.length, all: allCases.length,
  };
  const href = (f: FilterKey) =>
    `${ROUTES.cases}?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}${af ? `&af=${encodeURIComponent(af)}` : ""}`;
  const chips = FILTERS.map((f) => ({ id: f.id, label: `${f.label} (${counts[f.id]})`, href: href(f.id), active: filter === f.id }));

  const baseParams = { q, filter, af, ...cfParams };
  const { colsParam, menuItems } = optionalColumnsMenu({ baseHref: ROUTES.cases, optional: OPTIONAL, shown: shownOptional, linkParams: baseParams, sort, dir });
  const linkParams = { ...baseParams, cols: colsParam };

  const columns: ListColumn<CaseSummary>[] = [
    {
      id: "ref", label: "Ref · Equipment", sortKey: "ref", card: "title",
      render: ({ serviceCase: sc }) => (
        <Link href={ROUTES.case(sc.id)} style={{ textDecoration: "none" }}>
          <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: c.accent }}>{sc.ref}</div>
          <div style={{ fontWeight: 600, fontSize: 13, color: c.ink, marginTop: 2 }}>{sc.equipment_label || "—"}</div>
        </Link>
      ),
    },
    { id: "stage", label: "Stage", sortKey: "stage", render: ({ serviceCase: sc }) => <StatusPill label={CASE_STATUS_LABEL[sc.status]} tone={statusTone[sc.status]} /> },
    {
      id: "account", label: "Account", sortKey: "account",
      render: ({ account }) => (
        <Link href={ROUTES.account(account.id)} style={{ fontSize: 13, fontWeight: 500, color: c.ink, textDecoration: "none" }}>{account.name}</Link>
      ),
    },
    { id: "type", label: "Type", sortKey: "type", render: ({ serviceCase: sc }) => <StatusPill label={CASE_TYPE_LABEL[sc.type]} tone={typeTone[sc.type]} /> },
    {
      id: "technician", label: "Technician", sortKey: "technician", cellStyle: { fontSize: 13 },
      render: ({ technicianName }) => <span style={{ color: technicianName ? c.muted : c.hint }}>{technicianName ?? "—"}</span>,
    },
    { id: "intake", label: "Intake", sortKey: "intake", cellStyle: { color: c.hint, fontSize: 12.5, whiteSpace: "nowrap" }, render: ({ serviceCase: sc }) => fmtDate(sc.intake_at) },
    ...(shownOptional.has("complaint") ? [{
      id: "complaint", label: "Complaint", sortKey: "complaint", cellStyle: { maxWidth: 200, fontSize: 12.5, color: c.muted },
      render: ({ serviceCase: sc }: CaseSummary) => (
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sc.complaint || <span style={{ color: c.line }}>—</span>}
        </span>
      ),
    }] : []),
  ];

  const hasFilter = !!(q || af || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Cases"
      subtitle={`${allCases.length} total · ${open.length} open`}
      newLabel="Case"
      newHref={ROUTES.caseNew}
      menuItems={menuItems}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search ref, equipment or account…",
        hiddenParams: { filter, af, cols: colsParam, ...cfParams },
      }}
      advancedFilterObject="case"
      columns={columns}
      rows={pageRows}
      rowKey={({ serviceCase }) => serviceCase.id}
      rowHref={({ serviceCase }) => ROUTES.case(serviceCase.id)}
      total={sorted.length}
      page={page}
      baseHref={ROUTES.cases}
      sort={sort}
      dir={dir}
      linkParams={linkParams}
      filtered={hasFilter}
      empty={{
        title: filter === "open" ? "No open cases" : "No cases in this category",
        text: filter === "open" ? "Log a repair or service request as a case to track it from intake to delivery." : undefined,
        filteredTitle: q ? `No cases match "${q}".` : "No cases match these filters.",
      }}
      wrapBody={(body) => <CaseBoardSlot list={body} rows={rows} />}
    />
  );
}
