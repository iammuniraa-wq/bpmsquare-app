import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { parseListParams } from "@/lib/studio/requests";
import { PENDING_MESSAGE, listStudies, studioAccess, type ListedStudy } from "@/lib/studio/server";
import { STEP_IDS, STEP_LABEL, STUDY_STATUSES, STUDY_STATUS_LABEL } from "@/lib/studio/types";
import StudyStatusPill from "./StudyStatusPill";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function ProcessStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireWorkcenterView("process_studio");
  await requireFeature("process_studio");
  const ctx = await studioAccess("view");
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const p = parseListParams(sp);

  const [list, ...counts] = await Promise.all([
    listStudies(ctx, p),
    ...STUDY_STATUSES.map((s) => listStudies(ctx, { ...p, q: "", status: s, page: 1, page_size: 1 })),
  ]);

  if (list.missing) {
    return (
      <>
        <PageHeader title="Process Design Studio" />
        <Card padding={0}><EmptyState title="The Process Design Studio is waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }

  const all = counts.reduce((a, r) => a + r.total, 0);
  const href = (status: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (p.q) q.set("q", p.q);
    const s = q.toString();
    return s ? `${ROUTES.processStudio}?${s}` : ROUTES.processStudio;
  };
  const chips = [
    { id: "all", label: `All (${all})`, href: href(null), active: !p.status },
    ...STUDY_STATUSES.map((s, i) => ({ s, n: counts[i].total })).filter((x) => x.n > 0 || p.status === x.s)
      .map((x) => ({ id: x.s, label: `${STUDY_STATUS_LABEL[x.s]} (${x.n})`, href: href(x.s), active: p.status === x.s })),
  ];

  const COLUMNS: ListColumn<ListedStudy>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (s) => s.ref ?? "—" },
    { id: "name", label: "Study", card: "title", render: (s) => <Link href={ROUTES.processStudy(s.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{s.name}</Link> },
    { id: "status", label: "Status", render: (s) => <StudyStatusPill status={s.status} /> },
    { id: "version", label: "Version", cellStyle: { color: c.muted, fontSize: 13 }, render: (s) => (s.current_version > 0 ? `v${s.current_version}` : "—") },
    { id: "step", label: "Reached", cellStyle: { color: c.muted, fontSize: 13 }, render: (s) => STEP_LABEL[STEP_IDS[Math.min(Math.max(s.reached, 1), 6) - 1]] },
    { id: "updated_at", label: "Updated", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (s) => fmtDate(s.updated_at) },
  ];

  return (
    <ObjectListPage
      title="Process Design Studio"
      subtitle={`${all} stud${all === 1 ? "y" : "ies"}`}
      newLabel="Study"
      newHref={ROUTES.processStudioNew}
      chips={chips}
      search={{ value: p.q || undefined, placeholder: "Search by name or ID…", hiddenParams: { status: p.status ?? undefined } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={list.rows}
      rowKey={(s) => s.id}
      rowHref={(s) => ROUTES.processStudy(s.id)}
      total={list.total}
      page={p.page}
      pageSize={p.page_size}
      baseHref={ROUTES.processStudio}
      linkParams={{ q: p.q || undefined, status: p.status ?? undefined }}
      filtered={!!(p.q || p.status)}
      empty={{
        title: "No studies yet",
        text: "Tell us how you work and see how BPMSquare fits. About twenty minutes.",
        filteredTitle: p.q ? `No studies match "${p.q}".` : "No studies match these filters.",
      }}
    />
  );
}
