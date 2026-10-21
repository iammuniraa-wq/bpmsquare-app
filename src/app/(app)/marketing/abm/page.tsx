import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import StatusPill from "@/components/ui/StatusPill";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { listPrograms, userNames, type ProgramListRow } from "@/lib/abm/views";
import { PROGRAM_STATUS_LABEL, PROGRESS_LABEL, KIND_LABEL, GOAL_METRIC_LABEL } from "@/lib/abm/types";
import { abmPage, fmtDate } from "./pageData";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const STATUS_TONE = { draft: "purple", active: "green", paused: "amber", completed: "blue", archived: "purple" } as const;

type Row = ProgramListRow & { owner_name: string | null };

const SORT: Record<string, SortExtractor<Row>> = {
  ref: (r) => r.ref,
  name: (r) => r.name,
  window: (r) => r.starts_on,
  owner: (r) => r.owner_name,
  targets: (r) => r.target_total,
  status: (r) => r.status,
};

const CHIPS: { id: string; label: string; match: (r: Row) => boolean }[] = [
  { id: "active", label: "Live", match: (r) => r.status === "active" },
  { id: "paused", label: "Paused", match: (r) => r.status === "paused" },
  { id: "draft", label: "Draft", match: (r) => r.status === "draft" },
  { id: "completed", label: "Done", match: (r) => r.status === "completed" },
  { id: "all", label: "All", match: (r) => r.status !== "archived" },
];

/** A compact stacked bar: how many targets are reached, responding, in talks and in a deal, out of all of them. */
function ProgressBar({ r }: { r: Row }) {
  const total = r.target_total;
  if (total === 0) return <span style={{ color: c.hint, fontSize: 12.5 }}>No targets yet</span>;
  const reached = r.counts.reached;
  const engaged = r.counts.engaged;
  const talks = r.counts.in_talks;
  const deals = r.counts.deal_open + r.counts.won + r.counts.lost;
  const seg = (n: number, bg: string, label: string) => n > 0 ? <i key={label} title={`${label}: ${n}`} style={{ display: "block", height: "100%", width: `${(n / total) * 100}%`, background: bg }} /> : null;
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--line)" }} role="img" aria-label={`${reached} reached, ${engaged} responding, ${talks} in talks, ${deals} in a deal, of ${total}`}>
        {seg(reached, "var(--blueink)", "Reached")}
        {seg(engaged, "var(--tealink)", PROGRESS_LABEL.engaged)}
        {seg(talks, "var(--amberink)", "In talks")}
        {seg(deals, "var(--greenink)", "In a deal")}
      </div>
      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 4 }}>{reached + engaged + talks + deals} of {total} moving</div>
    </div>
  );
}

export default async function AbmProgramsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await abmPage();
  const params = await searchParams;
  const { q } = params;
  const view = CHIPS.find((x) => x.id === params.view) ?? CHIPS[4];
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const [{ rows: base, missing }, names] = await Promise.all([listPrograms(ctx), userNames(ctx)]);
  const rows: Row[] = base.map((p) => ({ ...p, owner_name: p.owner_user_id ? names.get(p.owner_user_id) ?? null : null }));

  const term = (q ?? "").trim().toLowerCase();
  const searched = rows.filter((r) => view.match(r) && (!term || `${r.ref ?? ""} ${r.name} ${r.goal ?? ""} ${r.owner_name ?? ""}`.toLowerCase().includes(term)));
  const filtered = sortRows(applyColFilters(searched, colFilters, SORT), sort, dir, SORT);
  const pageRows = paginate(filtered, page);
  const activeCount = rows.filter((r) => r.status === "active").length;

  const chips = CHIPS.map((x) => ({
    id: x.id,
    label: `${x.label} (${rows.filter((r) => x.match(r)).length})`,
    href: `${ROUTES.marketingAbm}?view=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    active: x.id === view.id,
  }));

  const columns: ListColumn<Row>[] = [
    { id: "ref", label: "ID", sortKey: "ref", width: 90, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (r) => r.ref ?? "—" },
    {
      id: "name", label: "Program", sortKey: "name", card: "title",
      render: (r) => (
        <>
          <Link href={ROUTES.marketingAbmProgram(r.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.name}</Link>
          <div style={{ fontSize: 11.5, color: c.hint }}>{KIND_LABEL[r.kind]}</div>
        </>
      ),
    },
    {
      id: "goal", label: "Goal", cellStyle: { color: c.muted, fontSize: 12.5, maxWidth: 260 },
      render: (r) => r.goal ? <span>{r.goal}</span> : <span style={{ color: c.hint }}>{GOAL_METRIC_LABEL[r.goal_metric]}{r.goal_target != null ? `: ${r.goal_target}` : ""}</span>,
    },
    { id: "window", label: "Window", sortKey: "window", cellStyle: { color: c.muted, fontSize: 12.5, whiteSpace: "nowrap" }, render: (r) => (r.starts_on || r.ends_on ? `${fmtDate(r.starts_on)} to ${fmtDate(r.ends_on)}` : "—") },
    { id: "owner", label: "Owner", sortKey: "owner", cellStyle: { color: c.muted, fontSize: 12.5 }, render: (r) => r.owner_name ?? "—" },
    { id: "targets", label: "Targets", sortKey: "targets", render: (r) => <ProgressBar r={r} /> },
    { id: "status", label: "Status", sortKey: "status", render: (r) => <StatusPill label={PROGRAM_STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
  ];

  return (
    <ObjectListPage
      title="ABM programs"
      subtitle={missing ? "Waiting for the ABM database update (migrations 0180 to 0183)" : `${activeCount} live`}
      newLabel="Program"
      newHref={ROUTES.marketingAbmNew}
      chips={chips}
      search={{ value: q, placeholder: "Search by name, ID, goal or owner…", hiddenParams: { view: view.id, ...cfParams } }}
      columns={columns}
      rows={pageRows}
      rowKey={(r) => r.id}
      rowHref={(r) => ROUTES.marketingAbmProgram(r.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.marketingAbm}
      sort={sort}
      dir={dir}
      linkParams={{ q, view: view.id, ...cfParams }}
      filtered={!!(term || Object.keys(cfParams).length > 0 || view.id !== "all")}
      empty={{
        title: missing ? "ABM programs will appear here once the database update has been applied." : "No programs yet",
        text: missing ? undefined : "Pick the companies that matter most and work them as a team. Start from a target group or choose accounts by hand.",
        filteredTitle: term ? `No programs match "${q}".` : "No programs here yet.",
      }}
    />
  );
}
