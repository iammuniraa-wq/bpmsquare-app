import { requireFeature, getTenantCurrency } from "@/lib/tenant";
import Link from "next/link";
import { listWorkOrders } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PagerLink from "@/components/PagerLink";
import { ROUTES } from "@/lib/constants";
import type { WorkOrderStatus } from "@/lib/types";
import { Zap, Gear, Droplet, Battery, Monitor, Activity } from "@/components/Icons";
import { requireWorkcenterView } from "@/lib/permissions";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import type { MenuItem } from "@/components/ui/menuItems";

type WorkOrderRow = Awaited<ReturnType<typeof listWorkOrders>>[number];

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT_EXTRACTORS: Record<string, SortExtractor<WorkOrderRow>> = {
  ref: (r) => r.workOrder.ref,
  account: (r) => r.account.name,
  asset: (r) => r.asset?.name,
  type: (r) => r.authKind,
  technician: (r) => r.technician?.name,
  scheduled: (r) => r.workOrder.scheduled_for,
  status: (r) => r.workOrder.status,
};

const STATUS_TONE: Record<WorkOrderStatus, PillarKey> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", invoiced: "Invoiced",
};
const STATUSES: WorkOrderStatus[] = ["scheduled", "in_progress", "completed", "invoiced"];

function KindIcon({ kind, size = 14, color }: { kind: string; size?: number; color?: string }) {
  const p = { size, color: color ?? "currentColor" };
  switch (kind) {
    case "motor":       return <Zap {...p} />;
    case "transformer": return <Gear {...p} />;
    case "pump":        return <Droplet {...p} />;
    case "generator":   return <Battery {...p} />;
    case "panel":       return <Monitor {...p} />;
    default:            return <Activity {...p} />;
  }
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; view?: string; q?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("work_orders");
  await requireFeature("work_orders");
  const cur = await getTenantCurrency();
  // Symbol currencies read as an icon ("₹ Billable"); ISO codes ("QAR Billable") do not.
  const moneyGlyph = cur.symbol.length === 1 ? cur.symbol + " " : "";
  const params = await searchParams;
  const { status: statusFilter, view, q, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const isCard = view === "card";

  const all = await listWorkOrders();
  const cnt = (s: WorkOrderStatus) => all.filter((r) => r.workOrder.status === s).length;
  let rows = statusFilter ? all.filter((r) => r.workOrder.status === statusFilter) : all;
  if (q) {
    const term = q.toLowerCase();
    rows = rows.filter((r) =>
      r.workOrder.ref.toLowerCase().includes(term) ||
      r.account.name.toLowerCase().includes(term) ||
      (r.asset?.name ?? "").toLowerCase().includes(term)
    );
  }
  rows = applyAdvancedFilter(rows, af, (r) => r.workOrder as unknown as Record<string, unknown>);
  rows = applyColFilters(rows, colFilters, SORT_EXTRACTORS);
  rows = sortRows(rows, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(rows, page);

  const vp = view ? `&view=${view}` : "";
  const chipHref = (s?: string) => `${ROUTES.workOrders}${s ? `?status=${s}${vp}` : vp ? `?${vp.slice(1)}` : ""}`;
  const chips = [
    ...STATUSES.map((s) => ({ id: s, label: `${STATUS_LABEL[s]} (${cnt(s)})`, href: chipHref(s), active: statusFilter === s })),
    { id: "all", label: `All (${all.length})`, href: chipHref(), active: !statusFilter },
  ];

  const linkParams = { status: statusFilter, view, q, af, ...cfParams };
  const viewHref = (v?: string) => {
    const qs = new URLSearchParams();
    for (const [k, val] of Object.entries({ ...linkParams, view: v, sort, dir: sort ? dir : undefined })) if (val) qs.set(k, val);
    const s = qs.toString();
    return s ? `${ROUTES.workOrders}?${s}` : ROUTES.workOrders;
  };
  const menuItems: MenuItem[] = [
    isCard ? { label: "Table view", href: viewHref(undefined) } : { label: "Card view", href: viewHref("card") },
  ];

  const columns: ListColumn<WorkOrderRow>[] = [
    {
      id: "ref", label: "Ref", sortKey: "ref", card: "title",
      render: ({ workOrder: wo, serviceCase }) => (
        <>
          <Link href={ROUTES.workOrder(wo.id)} style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: c.ink, textDecoration: "none" }}>{wo.ref}</Link>
          {serviceCase && (
            <div style={{ marginTop: 2 }}>
              <Link href={ROUTES.case(serviceCase.id)} style={{ color: pillar.teal.base, textDecoration: "none", fontWeight: 500, fontSize: 11.5 }}>{serviceCase.ref}</Link>
            </div>
          )}
        </>
      ),
    },
    {
      id: "account", label: "Account", sortKey: "account",
      render: ({ account }) => <Link href={ROUTES.account(account.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none", fontSize: 13 }}>{account.name}</Link>,
    },
    {
      id: "asset", label: "Asset", sortKey: "asset", cellStyle: { color: c.muted, fontSize: 12.5 },
      render: ({ asset }) => asset ? <span><KindIcon kind={asset.kind} size={12} /> {asset.name}</span> : "—",
    },
    {
      id: "type", label: "Type", sortKey: "type",
      render: ({ authKind, authRef }) => (
        <>
          <StatusPill label={authKind === "quote" ? "Billable" : "AMC"} tone={authKind === "quote" ? "blue" : "teal"} />
          <div style={{ fontSize: 11, marginTop: 3, color: authKind === "contract" ? pillar.teal.base : c.hint }}>
            {authKind === "contract" ? "▥ " : moneyGlyph}{authRef}
          </div>
        </>
      ),
    },
    {
      id: "technician", label: "Technician", sortKey: "technician", cellStyle: { fontSize: 13 },
      render: ({ technician }) => <span style={{ color: technician ? c.muted : c.hint }}>{technician?.name ?? "—"}</span>,
    },
    {
      id: "scheduled", label: "Scheduled", sortKey: "scheduled", cellStyle: { color: c.hint, fontSize: 12.5, whiteSpace: "nowrap" },
      render: ({ workOrder: wo }) => (wo.scheduled_for ? fmtDate(wo.scheduled_for) : "—"),
    },
    {
      id: "status", label: "Status", sortKey: "status",
      render: ({ workOrder: wo }) => <StatusPill label={STATUS_LABEL[wo.status]} tone={STATUS_TONE[wo.status]} />,
    },
  ];

  const cardGrid = (
    <>
      <div className="card-grid">
        {pageRows.map(({ workOrder: wo, account, asset, technician, authKind, serviceCase }) => {
          const tone = STATUS_TONE[wo.status];
          const p = pillar[tone];
          return (
            <Link
              key={wo.id}
              href={ROUTES.workOrder(wo.id)}
              style={{
                ...CARD_SURFACE, padding: 16, textDecoration: "none",
                borderTop: `3px solid ${p.base}`,
                display: "flex", flexDirection: "column", gap: 8,
                transition: "box-shadow .15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                <StatusPill label={STATUS_LABEL[wo.status]} tone={tone} />
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, color: c.accent }}>{account.name}</div>

              {asset && (
                <div style={{ fontSize: 12, color: c.muted }}>
                  <KindIcon kind={asset.kind} size={12} /> {asset.name}
                </div>
              )}

              <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", fontSize: 11, color: c.hint }}>
                <span>
                  {authKind === "contract" ? "▥ AMC" : `${moneyGlyph}Billable`}
                  {serviceCase ? ` · ${serviceCase.ref}` : ""}
                </span>
                <span>{wo.scheduled_for ? fmtDate(wo.scheduled_for) : ""}</span>
              </div>

              {technician && (
                <div style={{ fontSize: 11, fontWeight: 600, background: p.bg, color: p.fg, borderRadius: 4, padding: "2px 7px", alignSelf: "flex-start" }}>
                  {technician.name}
                </div>
              )}
            </Link>
          );
        })}
      </div>
      <PagerLink page={page} total={rows.length} pageSize={DEFAULT_PAGE_SIZE} baseHref={ROUTES.workOrders} hiddenParams={{ ...linkParams, sort, dir: sort ? dir : undefined }} />
    </>
  );

  const hasFilter = !!(q || af || statusFilter || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Work Orders"
      subtitle={`${all.length} total · ${cnt("in_progress")} in progress · ${cnt("scheduled")} scheduled`}
      menuItems={menuItems}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search ref, account or asset…",
        hiddenParams: { status: statusFilter, view, af, ...cfParams },
      }}
      advancedFilterObject="work_order"
      columns={columns}
      rows={pageRows}
      rowKey={({ workOrder }) => workOrder.id}
      rowHref={({ workOrder }) => ROUTES.workOrder(workOrder.id)}
      total={rows.length}
      page={page}
      baseHref={ROUTES.workOrders}
      sort={sort}
      dir={dir}
      linkParams={linkParams}
      filtered={hasFilter}
      empty={{
        title: "No work orders yet",
        text: "Work orders appear here once they are imported through Data Workbench or created by an integration.",
        filteredTitle: "No work orders match this filter.",
      }}
      wrapBody={isCard && rows.length > 0 ? () => cardGrid : undefined}
    />
  );
}
