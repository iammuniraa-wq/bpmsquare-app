import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { canEditWorkcenter, canViewWorkcenter, requireWorkcenterView, resolvePermissions } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import ObjectSections from "@/components/fields/ObjectSections";
import RevisionsPanel from "@/components/drawings/RevisionsPanel";
import ElementsPanel from "@/components/drawings/ElementsPanel";
import ComparePanel from "@/components/drawings/ComparePanel";
import UsedByPanel from "@/components/drawings/UsedByPanel";
import FiledUnderCard from "@/components/drawings/FiledUnderCard";
import { STATUS_TONE, fmtDate, type RevisionView } from "@/components/drawings/view";
import { loadDrawing, loadElementCounts, loadRevisions, loadType, namesFor } from "@/lib/drawings/server";
import { loadPinsOfDrawing } from "@/lib/drawings/boqPins";
import { headlineRevision, mayRelease, mayReturn } from "@/lib/drawings/rules";
import { STATUS_LABEL } from "@/lib/drawings/types";

export default async function DrawingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireWorkcenterView("drawing_register");
  await requireFeature("drawing_register");
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const { id } = await params;
  const { tab } = await searchParams;
  const admin = createAdminSupabase();

  const found = await loadDrawing(admin, tenantId, id);
  if (found.kind === "pending") redirect(ROUTES.drawings);
  if (found.kind !== "ok") notFound();
  const drawing = found.drawing;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "drawing_register")) redirect(ROUTES.dashboard);
  const canEdit = canEditWorkcenter(perms, "drawing_register");

  const [{ rows: revisions }, type] = await Promise.all([loadRevisions(admin, tenantId, id), loadType(admin, tenantId, drawing.type_id)]);
  const [names, counts, { pins }] = await Promise.all([
    namesFor(admin, tenantId, revisions.flatMap((r) => [r.submitted_by, r.released_by])),
    loadElementCounts(admin, tenantId, revisions.map((r) => r.id)),
    loadPinsOfDrawing(admin, tenantId, id),
  ]);
  const nameOf = (u: string | null) => (u ? names.get(u) ?? null : null);

  const views: RevisionView[] = revisions.map((r) => ({
    ...r, submitted_by_name: nameOf(r.submitted_by), released_by_name: nameOf(r.released_by), elementCount: counts.get(r.id) ?? 0,
    canRelease: r.status === "in_review" && mayRelease({ type, submittedBy: r.submitted_by, userId, role }),
    canReturn: mayReturn({ type, revision: r, userId, role }),
    canEdit: canEdit && r.status === "draft",
  }));
  const at = headlineRevision(revisions, drawing.current_rev_id);
  const waiting = revisions.filter((r) => r.status === "in_review").length;
  const hasOpen = revisions.some((r) => r.status === "draft" || r.status === "in_review");
  const released = revisions.find((r) => r.id === drawing.current_rev_id);
  const basePath = ROUTES.drawing(id);

  const [{ data: opp }, { data: prj }] = await Promise.all([
    drawing.opportunity_id ? admin.from("opportunities").select("id, ref, title").eq("id", drawing.opportunity_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    drawing.project_id ? admin.from("contract_projects").select("id, ref, name").eq("id", drawing.project_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const o = opp as { id: string; ref: string | null; title: string } | null;
  const p = prj as { id: string; ref: string | null; name: string } | null;

  return (
    <ObjectRecordPage
      backHref={ROUTES.drawings}
      backLabel="All drawings"
      title={drawing.drawing_no}
      tabTitle={`${drawing.drawing_no} ${drawing.title}`}
      reference={drawing.ref}
      meta={drawing.title}
      status={at ? <StatusPill label={`${at.rev_label} ${STATUS_LABEL[at.status]}`} tone={STATUS_TONE[at.status]} /> : undefined}
      menu={canEdit ? (
        <RecordMoreMenu
          inlineEdit={{ overviewHref: `${basePath}?tab=details` }}
          adapt={{ objectType: "drawing", objectLabel: "Drawing", isAdmin: role === "admin" }}
          remove={{ endpoint: `/api/drawings/${id}`, recordName: drawing.drawing_no, entityLabel: "drawing", afterHref: ROUTES.drawings, confirmBody: "Only a drawing that was never submitted can be deleted; otherwise archive it." }}
        />
      ) : undefined}
      facts={[
        { label: "Type", value: type?.name ?? "—" },
        { label: "Released", value: released ? `${released.rev_label}, ${fmtDate(released.released_at)}` : "Not yet" },
        { label: "Filed under", value: o ? (o.ref ?? o.title) : p ? (p.ref ?? p.name) : "—" },
        { label: "Waiting", value: waiting > 0 ? `${waiting} for release` : "Nothing" },
      ]}
      externalLine={<ExternalRecordSlot objectType="drawings" objectId={id} />}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        { id: "revisions", label: "Revisions", count: revisions.length, content: <RevisionsPanel drawingId={id} revisions={views} canEdit={canEdit} hasOpen={hasOpen} /> },
        { id: "elements", label: "Elements", content: <ElementsPanel drawingId={id} revisions={views} canEdit={canEdit} isAdmin={role === "admin"} /> },
        { id: "compare", label: "Compare", content: <ComparePanel drawingId={id} revisions={views} /> },
        { id: "usedby", label: "Used by", count: pins.length, content: <UsedByPanel drawingId={id} opportunityId={drawing.opportunity_id} pins={pins} canEdit={canEdit} hasRelease={!!drawing.current_rev_id} /> },
        {
          id: "details", label: "Details",
          content: (
            <div style={{ display: "grid", gap: 12 }}>
            <FiledUnderCard drawingId={id} opportunityId={drawing.opportunity_id} projectId={drawing.project_id} wbsItemId={drawing.wbs_item_id} canEdit={canEdit} />
            <ObjectSections objectType="drawing" record={{ ...drawing, released_rev: released?.rev_label ?? "" } as unknown as Record<string, unknown>} patchUrl={`/api/drawings/${id}`} exclude={[]} />
            </div>
          ),
        },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="drawings" objectId={id} isAdmin={role === "admin"} /> },
      ]}
      rail={(o || p) ? (
        <div style={{ fontSize: 13, color: c.muted, display: "grid", gap: 6 }}>
          {o && <div>Tender: <Link href={`/pipeline/${o.id}`}>{o.ref ?? o.title}</Link></div>}
          {p && <div>Project: <Link href={ROUTES.contractProject(p.id)}>{p.ref ?? p.name}</Link></div>}
        </div>
      ) : undefined}
    />
  );
}
