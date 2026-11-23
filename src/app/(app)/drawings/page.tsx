import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, type SortExtractor } from "@/lib/listSort";
import { loadDrawingList, type DrawingListRow } from "@/lib/drawings/list";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { STATUS_LABEL } from "@/lib/drawings/types";
import { STATUS_TONE } from "@/components/drawings/view";

// The drawing register list. Hidden unless the workspace has the module (feature drawing_register, platform-admin only).

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT: Record<string, SortExtractor<DrawingListRow>> = {
  ref: (d) => d.ref, drawing_no: (d) => d.drawing_no, title: (d) => d.title, type_name: (d) => d.type_name, at_label: (d) => d.at_label, filed_under: (d) => d.filed_under, created_at: (d) => d.created_at,
};

const COLUMNS: ListColumn<DrawingListRow>[] = [
  { id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (d) => d.ref ?? "—" },
  {
    id: "drawing_no", label: "Drawing", sortKey: "drawing_no", card: "title",
    render: (d) => (
      <>
        <Link href={ROUTES.drawing(d.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{d.drawing_no}</Link>
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, fontWeight: 400 }}>{d.title}</div>
      </>
    ),
  },
  { id: "type_name", label: "Type", sortKey: "type_name", cellStyle: { color: c.muted, fontSize: 13 }, render: (d) => d.type_name ?? "—" },
  {
    id: "at_label", label: "At", sortKey: "at_label",
    render: (d) => d.at_label && d.at_status ? <span style={{ whiteSpace: "nowrap" }}><strong>{d.at_label}</strong> <StatusPill label={STATUS_LABEL[d.at_status]} tone={STATUS_TONE[d.at_status]} /></span> : "—",
  },
  { id: "waiting", label: "Waiting", render: (d) => d.waiting ? <StatusPill label="Release" tone="amber" /> : "" },
  { id: "filed_under", label: "Filed under", sortKey: "filed_under", cellStyle: { color: c.muted, fontSize: 13 }, render: (d) => d.filed_under ?? "—" },
];

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireWorkcenterView("drawing_register");
  await requireFeature("drawing_register");
  const { tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const view = ["waiting", "released", "draft"].includes(params.view ?? "") ? (params.view as string) : "all";

  const list = await loadDrawingList(createAdminSupabase(), tenantId);
  const live = list.rows.filter((d) => !d.archived_at);
  const q = params.q?.trim().toLowerCase();
  const filtered = live.filter((d) => {
    if (view === "waiting" && !d.waiting) return false;
    if (view === "released" && !d.released) return false;
    if (view === "draft" && (d.released || d.at_status !== "draft")) return false;
    return !q || `${d.drawing_no} ${d.title} ${d.ref ?? ""} ${d.external_no ?? ""}`.toLowerCase().includes(q);
  });
  const sorted = sortRows(filtered, sort, dir, SORT);
  const href = (v: string) => `${ROUTES.drawings}?view=${v}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`;
  const chips = [
    { id: "all", label: `All (${live.length})` },
    { id: "waiting", label: `Waiting for release (${live.filter((d) => d.waiting).length})` },
    { id: "released", label: `Released (${live.filter((d) => d.released).length})` },
    { id: "draft", label: `Draft only (${live.filter((d) => !d.released && d.at_status === "draft").length})` },
  ].map((ch) => ({ ...ch, href: href(ch.id), active: view === ch.id }));

  return (
    <ObjectListPage
      title="Drawings"
      subtitle={`${live.length} total`}
      info={DRAWING_TIPS.list}
      newLabel="Drawing"
      newHref={ROUTES.drawingNew}
      chips={chips}
      search={{ value: params.q, placeholder: "Search by number, title or ID…", hiddenParams: { view: view === "all" ? undefined : view } }}
      columns={COLUMNS}
      rows={paginate(sorted, page)}
      rowKey={(d) => d.id}
      rowHref={(d) => ROUTES.drawing(d.id)}
      total={sorted.length}
      page={page}
      baseHref={ROUTES.drawings}
      sort={sort}
      dir={dir}
      linkParams={{ q: params.q, view: view === "all" ? undefined : view }}
      filtered={!!(params.q || view !== "all")}
      columnSearch={false}
      beforeTable={list.pending ? (
        <div role="alert" data-guide="drawings.pending_migration" style={{ fontSize: 13, color: "var(--amberink)", marginBottom: 10 }}>
          The drawing register needs a database update (migrations 0255 and 0256). Ask your administrator to apply it.
        </div>
      ) : undefined}
      empty={{
        title: "No drawings yet",
        text: "Add a drawing with its number and file, submit it, and a named approver releases it.",
        filteredTitle: params.q ? `No drawings match "${params.q}".` : "No drawings in this view.",
      }}
    />
  );
}
