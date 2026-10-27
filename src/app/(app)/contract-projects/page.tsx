import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { listProjects, type ProjectListRow } from "@/lib/contractProjects/list";
import { money, pct, projectTone, day } from "@/lib/contractProjects/format";
import { PROJECT_STATUS_LABEL, PROJECT_STATUSES } from "@/lib/contractProjects/types";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const COLUMNS: ListColumn<ProjectListRow>[] = [
  { id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (p) => p.ref ?? "—" },
  {
    id: "name", label: "Project", sortKey: "name", card: "title",
    render: (p) => (
      <>
        <Link href={ROUTES.contractProject(p.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{p.name}</Link>
        {p.account_name && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, fontWeight: 400 }}>{p.account_name}</div>}
      </>
    ),
  },
  { id: "status", label: "Status", sortKey: "status", render: (p) => <StatusPill label={PROJECT_STATUS_LABEL[p.status]} tone={projectTone(p.status)} /> },
  { id: "contract_value", label: "Contract value", sortKey: "contract_value", cellStyle: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }, render: (p) => money(p.contract_value, p.currency) },
  {
    id: "budget_total", label: "Budget", sortKey: "budget_total", cellStyle: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
    render: (p) => (p.budget_total === null ? "—" : <>{money(p.budget_total, p.currency)}{p.budget_state !== "approved" && <span style={{ color: c.hint, fontSize: 11.5 }}> · {p.budget_state === "pending" ? "waiting" : "draft"}</span>}</>),
  },
  { id: "margin_pct", label: "Margin", sortKey: "margin_pct", cellStyle: { fontVariantNumeric: "tabular-nums" }, render: (p) => pct(p.margin_pct) },
  { id: "planned_end", label: "Ends", sortKey: "planned_end", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (p) => day(p.planned_end) },
];

export default async function ContractProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireWorkcenterView("contract_projects");
  await requireFeature("contract_projects");
  const { tenantId } = await requireTenantUser();
  const params = await searchParams;
  const status = params.status && (PROJECT_STATUSES as readonly string[]).includes(params.status) ? params.status : "all";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.page) || 1);
  const out = await listProjects(createAdminSupabase(), tenantId, { status, q: params.q, sort: params.sort, dir, page, pageSize: DEFAULT_PAGE_SIZE });

  const s = out.summary;
  const href = (st: string) => `${ROUTES.contractProjects}?status=${st}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`;
  const chips = [{ id: "all", label: `All (${out.counts.all ?? 0})` }, ...PROJECT_STATUSES.map((s) => ({ id: s, label: `${PROJECT_STATUS_LABEL[s]} (${out.counts[s] ?? 0})` }))]
    .map((ch) => ({ ...ch, href: href(ch.id), active: status === ch.id }));

  return (
    <ObjectListPage
      title="Contract Projects"
      subtitle={`${out.counts.all ?? 0} total`}
      newLabel="Contract Project"
      newHref={ROUTES.contractProjectNew}
      chips={chips}
      search={{ value: params.q, placeholder: "Search by name, ID or customer…", hiddenParams: { status: status === "all" ? undefined : status } }}
      columns={COLUMNS}
      rows={out.rows}
      rowKey={(p) => p.id}
      rowHref={(p) => ROUTES.contractProject(p.id)}
      total={out.total}
      page={page}
      baseHref={ROUTES.contractProjects}
      sort={params.sort}
      dir={dir}
      linkParams={{ q: params.q, status: status === "all" ? undefined : status }}
      filtered={!!(params.q || status !== "all")}
      columnSearch={false}
      beforeTable={out.pending ? (
        <div role="alert" data-guide="cp.pending_migration" style={{ fontSize: 13, color: "var(--amberink)", marginBottom: 10 }}>
          Contract projects need a database update (migration 0226). Ask your administrator to apply it.
        </div>
      ) : (out.counts.all ?? 0) > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <StatStrip guide="cp.list_summary">
            <StatTile tone="good" label="Active projects" value={String(s.active)} sub={`${out.counts.all ?? 0} in total`} />
            <StatTile tone="info" label="Contract value" value={s.currency === "" ? "—" : money(s.contractValue, s.currency)} sub={s.currency === "" ? "Mixed currencies" : "active projects"} />
            <StatTile tone="info" label="Budget" value={s.currency === "" ? "—" : money(s.budget, s.currency)} sub={s.currency === "" ? "Mixed currencies" : "active projects"} />
            <StatTile tone={s.negativeMargin > 0 ? "bad" : s.lowMargin > 0 ? "warn" : "good"} label="Margin below 10%" value={String(s.lowMargin)} sub={s.negativeMargin > 0 ? `${s.negativeMargin} below zero` : s.lowMargin > 0 ? "active projects" : "none"} />
          </StatStrip>
        </div>
      ) : undefined}
      empty={{
        title: "No contract projects yet",
        text: "Open an awarded tender and choose Create contract project, or start one by hand.",
        filteredTitle: params.q ? `No contract projects match "${params.q}".` : "No contract projects have this status.",
      }}
    />
  );
}
