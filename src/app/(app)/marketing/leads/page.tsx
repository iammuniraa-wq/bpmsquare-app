import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { LEAD_STAGES, isLeadStageKey, stageDefOf } from "@/lib/marketing/leadStages";
import { leadPage } from "@/lib/marketing/leads/pageGuard";
import { listScoredLeads, type ScoredLead } from "@/lib/marketing/leads/queries";
import { listWorkspacePeople, personLabel } from "@/lib/marketing/leads/people";
import { isLeadOverdue } from "@/lib/marketing/leads/timing";
import { AssignmentChip, DueChip, ScoreMeter, StagePill } from "./ScoreBits";

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default async function ScoredLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string; page?: string; sort?: string; dir?: string } & Record<string, string | undefined>>;
}) {
  const ctx = await leadPage();
  const params = await searchParams;
  const { stage: stageParam, q } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const { leads, pending } = await listScoredLeads(ctx.admin, ctx.tenantId);
  if (pending) {
    return (
      <>
        <PageHeader title="Scored leads" />
        <Card padding={0}>
          <EmptyState title="Lead scoring is waiting for a database update" text="Ask your administrator to apply the latest database update, then come back. Nothing is lost in the meantime." />
        </Card>
      </>
    );
  }

  const people = await listWorkspacePeople(ctx.admin, ctx.tenantId);
  const byId = new Map(people.map((p) => [p.user_id, p]));
  const ownerName = (l: ScoredLead) => (l.owner_user_id ? personLabel(byId.get(l.owner_user_id)) : "");

  const overdueCount = leads.filter((l) => isLeadOverdue(l.stage, l.sla_due_at, ctx.now)).length;
  const stageFilter = stageParam === "overdue" || isLeadStageKey(stageParam) ? stageParam : undefined;

  const bySearch = leads.filter((l) => {
    if (stageFilter === "overdue" ? !isLeadOverdue(l.stage, l.sla_due_at, ctx.now) : stageFilter && l.stage !== stageFilter) return false;
    if (!q) return true;
    const term = q.toLowerCase();
    return (l.title ?? "").toLowerCase().includes(term) || l.account_name.toLowerCase().includes(term) || (l.contact_name ?? "").toLowerCase().includes(term);
  });

  const EXTRACT: Record<string, SortExtractor<ScoredLead>> = {
    lead: (l) => l.title,
    account: (l) => l.account_name,
    score: (l) => l.score,
    stage: (l) => stageDefOf(l.stage).label,
    owner: (l) => ownerName(l),
    due: (l) => l.sla_due_at,
    scored: (l) => l.scored_at,
  };
  const rows = sortRows(applyColFilters(bySearch, colFilters, EXTRACT), sort, dir, EXTRACT);
  const pageRows = paginate(rows, page);

  const here = (stage?: string) => `${ROUTES.marketingLeads}${stage || q ? "?" : ""}${[stage ? `stage=${stage}` : "", q ? `q=${encodeURIComponent(q)}` : ""].filter(Boolean).join("&")}`;
  const chips = [
    { id: "all", label: `All (${leads.length})`, href: here(), active: !stageFilter },
    ...LEAD_STAGES.filter((s) => leads.some((l) => l.stage === s.key) || s.key === "ready").map((s) => ({
      id: s.key, label: `${s.label} (${leads.filter((l) => l.stage === s.key).length})`, href: here(s.key), active: stageFilter === s.key,
    })),
    ...(overdueCount > 0 ? [{ id: "overdue", label: `Overdue (${overdueCount})`, href: here("overdue"), active: stageFilter === "overdue" }] : []),
  ];

  const columns: ListColumn<ScoredLead>[] = [
    {
      id: "lead", label: "Lead", sortKey: "lead", card: "title",
      render: (l) => (
        <>
          <Link href={ROUTES.marketingLead(l.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{l.title ?? "Untitled lead"}</Link>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{l.account_name}{l.contact_name ? ` · ${l.contact_name}` : ""}</div>
        </>
      ),
    },
    { id: "score", label: "Score", sortKey: "score", render: (l) => <ScoreMeter score={l.score} thresholds={ctx.rubric.thresholds} /> },
    { id: "stage", label: "Stage", sortKey: "stage", render: (l) => <StagePill stage={l.stage} /> },
    {
      id: "owner", label: "Owner", sortKey: "owner", cellStyle: { fontSize: 13 },
      render: (l) => (l.owner_user_id ? <span style={{ color: c.ink }}>{personLabel(byId.get(l.owner_user_id))}</span> : l.stage === "ready" ? <StatusPill label="Needs an owner" tone="amber" /> : <span style={{ color: c.hint }}>—</span>),
    },
    { id: "due", label: "Respond by", sortKey: "due", render: (l) => <DueChip stage={l.stage} slaDueAt={l.sla_due_at} now={ctx.now} /> },
    { id: "assignment", label: "Routed", card: "hidden", render: (l) => <AssignmentChip reason={l.stage === "ready" ? l.assignment_reason : null} /> },
    { id: "scored", label: "Scored", sortKey: "scored", cellStyle: { color: c.muted, fontSize: 12.5, whiteSpace: "nowrap" }, render: (l) => (l.scored_at ? fmtDate(l.scored_at) : "Not yet") },
  ];

  return (
    <ObjectListPage
      title="Scored leads"
      subtitle={`${rows.length} of ${leads.length} · best score first. A score is worked out from what each person did, so it is never a guess.`}
      chips={chips}
      search={{ value: q, placeholder: "Search lead, company or person…", hiddenParams: { stage: stageFilter } }}
      columns={columns}
      rows={pageRows}
      rowKey={(l) => l.id}
      rowHref={(l) => ROUTES.marketingLead(l.id)}
      total={rows.length}
      page={page}
      baseHref={ROUTES.marketingLeads}
      sort={sort}
      dir={dir}
      linkParams={{ stage: stageFilter, q, sort, dir: sort ? dir : undefined, ...cfParams }}
      filtered={!!(q || stageFilter || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No leads yet",
        text: "Leads appear here as people at your companies are scored, every 15 minutes. Add a lead from the Leads page, or press Score again on a lead.",
        filteredTitle: "No leads match these filters.",
      }}
    />
  );
}
