import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisorPage, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Pill from "@/components/Pill";
import ListFilterBar from "@/components/ListFilterBar";
import SortableTh from "@/components/SortableTh";
import PagerLink from "@/components/PagerLink";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { sortRows, readSortParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import type { WfmProject, WfmProjectStatus } from "@/lib/wfm/types";
import ProjectHoursTiles from "./ProjectHoursTiles";
import { depthOf } from "@/lib/wfm/projectTree";

const STATUS_LABEL: Record<WfmProjectStatus, string> = {
  planned: "Planned", active: "Active", on_hold: "On hold",
  completed: "Completed", cancelled: "Cancelled",
};

const STATUS_TONE: Record<WfmProjectStatus, "green" | "amber" | "red" | "blue" | "purple"> = {
  planned: "blue", active: "green", on_hold: "amber",
  completed: "purple", cancelled: "red",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SORT_EXTRACTORS: Record<string, SortExtractor<WfmProject>> = {
  ref: (p) => p.ref,
  name: (p) => p.name,
  code: (p) => p.code,
  status: (p) => p.status,
  start_date: (p) => p.start_date,
  end_date: (p) => p.end_date,
  budget_hours: (p) => p.budget_hours,
};

/** Depth-first order: each project immediately followed by its own sub-items.
 *  Anything whose parent isn't in the list (filtered out, or a broken link) is
 *  appended at the end rather than dropped -- a project must never vanish from
 *  its own list because of how the tree was drawn. */
function orderAsTree(
  rows: WfmProject[],
  nodes: Map<string, { id: string; parent_id: string | null }>
): WfmProject[] {
  const byParent = new Map<string | null, WfmProject[]>();
  const present = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const key = r.parent_id && present.has(r.parent_id) ? r.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: WfmProject[] = [];
  const walk = (parent: string | null) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push(r);
      walk(r.id);
    }
  };
  walk(null);
  // Safety net: anything the walk missed (a cycle) still gets listed.
  for (const r of rows) if (!out.includes(r)) out.push(r);
  return out;
}

export default async function WfmProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  // Project costing is its own purchase -- a tenant with attendance alone
  // must not reach this screen by typing the URL.
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  const { supabase, tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { q, status: statusFilter } = params;
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  // 0104 is applied by hand (§3b) -- until it runs this renders as an empty
  // list with a clear note, never a crash.
  const { data: rows, error } = await supabase
    .from("wfm_projects")
    .select("id, ref, name, code, parent_id, account_id, status, start_date, end_date, budget_hours")
    .eq("tenant_id", tenantId)
    .order("name");
  const pendingMigration = error?.code === "42P01";
  const projects: WfmProject[] = (rows ?? []) as unknown as WfmProject[];

  const searched = projects.filter((p) => {
    if (statusFilter && statusFilter !== "all" && p.status !== statusFilter) return false;
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.code ?? "").toLowerCase().includes(term) ||
      (p.ref ?? "").toLowerCase().includes(term)
    );
  });
  const sorted = sortRows(searched, sort, dir, SORT_EXTRACTORS);

  // Sub-items are shown INDENTED UNDER their parent rather than as peers, so
  // the list reads as the structure it is. Only when no filter or sort is
  // narrowing the view -- once someone searches, a bare flat list of matches
  // is more useful than a tree with most of its branches missing.
  const nodes = new Map(projects.map((p) => [p.id, { id: p.id, parent_id: p.parent_id }]));
  const treeView = !q && !statusFilter && !sort;
  const ordered = treeView ? orderAsTree(sorted, nodes) : sorted;
  const depths = new Map(ordered.map((p) => [p.id, treeView ? (depthOf(nodes, p.id) ?? 0) : 0]));
  // Indentation is only drawn in tree view, but the Level badge is true of a
  // row however the list is sorted, so it reads its own depth every time.
  const levels = new Map(projects.map((p) => [p.id, depthOf(nodes, p.id) ?? 0]));

  const filtered = ordered;
  const pageRows = paginate(filtered, page);

  const activeCount = projects.filter((p) => p.status === "active").length;

  // Hours for the current month, so the list answers "where is time going"
  // without a second click. Scoped by the same supervisor boundary as the
  // API because it goes through the same route.
  const config = await getWfmConfig(createAdminSupabase(), tenantId);
  const today = dateKeyInTz(new Date(), config.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;

  const filterHref = (s: string) =>
    `${ROUTES.wfmProjects}?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <TabTitle title="Workforce — Projects" />
      <PageHeader
        title="Projects"
        subtitle={
          pendingMigration
            ? "Project costing isn't set up on this database yet."
            : `${projects.length} total · ${activeCount} active · hours attributed from punches`
        }
        action={
          <Link
            href={ROUTES.wfmProjectNew}
            style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + Add Project
          </Link>
        }
      />

      {pendingMigration ? (
        <div style={{ ...cardStyle, padding: "40px 24px", textAlign: "center", color: c.hint, fontSize: 14 }}>
          Migration <code>0104_wfm_projects.sql</code> hasn&apos;t been run on this database yet.
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Everything else in Workforce keeps working — this screen fills in once it does.
          </div>
        </div>
      ) : (
        <>
          <ProjectHoursTiles from={monthStart} to={today} />

          <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
            {([["all", `All (${projects.length})`], ...(Object.keys(STATUS_LABEL) as WfmProjectStatus[])
              .map((s) => [s, STATUS_LABEL[s]] as const)] as readonly (readonly [string, string])[])
              .map(([id, label]) => {
                const on = (statusFilter ?? "all") === id;
                return (
                  <Link key={id} href={filterHref(id)} style={{
                    fontSize: 12.5, fontWeight: on ? 700 : 500,
                    color: on ? c.accent : c.muted,
                    background: on ? c.accentbg : c.panel2,
                    border: `1px solid ${on ? c.accent + "60" : c.line}`,
                    borderRadius: 6, padding: "5px 12px", textDecoration: "none",
                  }}>
                    {label}
                  </Link>
                );
              })}
          </div>

          <ListFilterBar
            searchValue={q}
            searchPlaceholder="Search by name, job number or ID…"
            hiddenParams={{ status: statusFilter && statusFilter !== "all" ? statusFilter : undefined }}
            clearHref={ROUTES.wfmProjects}
          />

          <div style={{ ...cardStyle, overflow: "hidden" }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
                {q || statusFilter ? "No projects match that filter." : "No projects yet."}
                {!q && !statusFilter && (
                  <div style={{ marginTop: 12 }}>
                    <Link href={ROUTES.wfmProjectNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                      + Add your first project
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                      {(() => {
                        const hp = { q, status: statusFilter };
                        const common = { currentSort: sort, currentDir: dir, baseHref: ROUTES.wfmProjects, hiddenParams: hp };
                        return (
                          <>
                            <SortableTh label="ID" sortKey="ref" searchId="ref" {...common} style={{ ...th, width: 88 }} />
                            <SortableTh label="Project" sortKey="name" searchId="name" {...common} style={th} />
                            <SortableTh label="Job no." sortKey="code" searchId="code" {...common} style={th} />
                            <SortableTh label="Status" sortKey="status" searchId="status" {...common} style={th} />
                            <SortableTh label="Start" sortKey="start_date" searchId="start_date" {...common} style={th} />
                            <SortableTh label="End" sortKey="end_date" searchId="end_date" {...common} style={th} />
                            <SortableTh label="Budget hrs" sortKey="budget_hours" searchId="budget_hours" {...common} style={th} />
                          </>
                        );
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((p: WfmProject) => (
                      <tr key={p.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                        <td style={{ ...td, color: c.hint, fontSize: 12.5 }}>{p.ref ?? "—"}</td>
                        <td style={td}>
                          <span style={{ paddingLeft: (depths.get(p.id) ?? 0) * 18 }}>
                            {(depths.get(p.id) ?? 0) > 0 && (
                              <span aria-hidden style={{ color: c.hint, marginRight: 6 }}>└</span>
                            )}
                            <Link href={ROUTES.wfmProject(p.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                              {p.name}
                            </Link>
                            {/* Depth IS the level, so the badge needs no
                                stored word -- Level 1 sits under the project. */}
                            {(levels.get(p.id) ?? 0) > 0 && (
                              <span style={{
                                marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: c.hint,
                                background: c.panel2, border: `1px solid ${c.line}`,
                                borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap",
                              }}>
                                Level {levels.get(p.id)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={{ ...td, color: c.muted }}>{p.code ?? "—"}</td>
                        <td style={td}><Pill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /></td>
                        <td style={{ ...td, color: c.muted }}>{fmtDate(p.start_date)}</td>
                        <td style={{ ...td, color: c.muted }}>{fmtDate(p.end_date)}</td>
                        <td style={{ ...td, color: c.muted }}>{p.budget_hours ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <PagerLink
            page={page}
            total={filtered.length}
            pageSize={DEFAULT_PAGE_SIZE}
            baseHref={ROUTES.wfmProjects}
            hiddenParams={{ q, status: statusFilter, sort, dir }}
          />
        </>
      )}
    </>
  );
}
