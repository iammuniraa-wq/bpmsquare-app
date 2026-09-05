import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisorPage, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ListFilterBar from "@/components/ListFilterBar";
import SortableTh from "@/components/SortableTh";
import PagerLink from "@/components/PagerLink";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { sortRows, readSortParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import type { WfmProject, WfmProjectStatus } from "@/lib/wfm/types";
import ProjectHoursTiles from "./ProjectHoursTiles";
import ProjectTreeRows from "./ProjectTreeRows";
import SettingsSection from "@/components/settings/SettingsSection";

const STATUS_LABEL: Record<WfmProjectStatus, string> = {
  planned: "Planned", active: "Active", on_hold: "On hold",
  completed: "Completed", cancelled: "Cancelled",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const SORT_EXTRACTORS: Record<string, SortExtractor<WfmProject>> = {
  ref: (p) => p.ref,
  name: (p) => p.name,
  code: (p) => p.code,
  status: (p) => p.status,
  start_date: (p) => p.start_date,
  end_date: (p) => p.end_date,
  budget_hours: (p) => p.budget_hours,
};

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

  // Account names for the column -- one tenant-scoped read, not a join the
  // 42P01 fallback would have to survive.
  const { data: accountRows } = await supabase.from("accounts").select("id, name").eq("tenant_id", tenantId);
  const accountNames: Record<string, string> = Object.fromEntries((accountRows ?? []).map((a) => [a.id as string, a.name as string]));

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

  // The list is a tree: sub-projects live under their parent, expanded and
  // created in place (ProjectTreeRows). Only when no filter or sort narrows
  // the view -- once someone searches, a flat list of matches is more useful
  // than a tree with most of its branches missing. In tree view the page is
  // a page of PROJECTS; each brings all its sub-projects with it, so a tree
  // is never cut in half by a page boundary.
  const present = new Set(projects.map((p) => p.id));
  const treeView = !q && !statusFilter && !sort;
  const filtered = treeView
    ? sorted.filter((p) => !p.parent_id || !present.has(p.parent_id))
    : sorted;
  const pageRows = paginate(filtered, page);

  const activeCount = projects.filter((p) => p.status === "active").length;

  // Hours for the current month, so the list answers "where is time going"
  // without a second click. Scoped by the same supervisor boundary as the
  // API because it goes through the same route.
  const config = await getWfmConfig(createAdminSupabase(), tenantId);
  const today = dateKeyInTz(new Date(), config.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;

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
          {/* Insights are collapsed by default (owner: "hide insights") -- the
              hours now sit on each row, so the donut is the deep dive, not
              the first thing on the screen. Collapsed means the tiles never
              fetch until someone opens them. */}
          <div style={{ marginBottom: 12 }}>
            <SettingsSection id="wfm-projects-insights" title="Insights" summary="Hours this month by project, and what nobody attributed">
              <ProjectHoursTiles from={monthStart} to={today} />
            </SettingsSection>
          </div>

          <ListFilterBar
            searchValue={q}
            searchPlaceholder="Search by name, job number or ID…"
            selects={[{
              name: "status",
              value: statusFilter && statusFilter !== "all" ? statusFilter : undefined,
              placeholder: "All statuses",
              options: (Object.keys(STATUS_LABEL) as WfmProjectStatus[]).map((v) => ({ value: v, label: STATUS_LABEL[v] })),
            }]}
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
                            <SortableTh label="ID" sortKey="ref" searchId="ref" {...common} style={{ ...th, width: 88 }} className="mob-hide" />
                            <SortableTh label="Project" sortKey="name" searchId="name" {...common} style={th} />
                            <th style={th} className="mob-hide">Account</th>
                            <SortableTh label="Job no." sortKey="code" searchId="code" {...common} style={th} className="mob-hide" />
                            <SortableTh label="Status" sortKey="status" searchId="status" {...common} style={th} />
                            <SortableTh label="Start" sortKey="start_date" searchId="start_date" {...common} style={th} className="mob-hide" />
                            <SortableTh label="End" sortKey="end_date" searchId="end_date" {...common} style={th} className="mob-hide" />
                            <SortableTh label="Budget hrs" sortKey="budget_hours" searchId="budget_hours" {...common} style={th} className="mob-hide" />
                            <th style={{ ...th, textAlign: "right" }}>Hours</th>
                            <th style={{ ...th, width: 40 }} aria-label="Add sub-project" />
                          </>
                        );
                      })()}
                    </tr>
                  </thead>
                  <ProjectTreeRows rows={pageRows} all={projects} tree={treeView} from={monthStart} to={today} accountNames={accountNames} />
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
