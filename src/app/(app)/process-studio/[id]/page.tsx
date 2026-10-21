import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { getCapabilityCatalog, catalogById } from "@/lib/capability/catalog";
import { MODULE_LABEL } from "@/lib/capability/generate";
import { PENDING_MESSAGE, loadBundle, loadOwnedStudy, studioAccess } from "@/lib/studio/server";
import { countRatings } from "@/lib/studio/ratings";
import { STEP_IDS, type CapabilityView, type StepId } from "@/lib/studio/types";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import ObjectSections from "@/components/fields/ObjectSections";
import StudyStatusPill from "../StudyStatusPill";
import StudioScreen from "../StudioScreen";
import { PrimaryAction, TourButton } from "../HeaderActions";

export default async function ProcessStudyPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  await requireWorkcenterView("process_studio");
  await requireFeature("process_studio");
  const ctx = await studioAccess("view");
  const { id } = await params;
  const { step: stepParam } = await searchParams;

  const loaded = await loadOwnedStudy(ctx, id);
  if (loaded.missing) {
    return (
      <>
        <PageHeader title="Process Design Studio" />
        <Card padding={0}><EmptyState title="The Process Design Studio is waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }
  // Another creator's study on the demo workspace answers exactly like a missing one.
  if (!loaded.data) notFound();
  const study = loaded.data;
  const bundle = await loadBundle(ctx, study);

  const perms = await resolvePermissions(ctx.supabase, ctx.tenantId, ctx.userId, ctx.role);
  const canEdit = canEditWorkcenter(perms, "process_studio");
  const canDelete = canDeleteWorkcenter(perms, "process_studio");

  // The step shown: the one asked for if it is unlocked, otherwise the furthest reached.
  const furthest = STEP_IDS[Math.min(Math.max(study.reached, 1), 6) - 1];
  const asked = STEP_IDS.find((s) => s === stepParam);
  const step: StepId = asked && STEP_IDS.indexOf(asked) < study.reached ? asked : furthest;

  // Only the entries this study cites travel to the browser.
  const byId = catalogById(getCapabilityCatalog());
  const caps: Record<string, CapabilityView> = {};
  for (const f of bundle.fit) {
    for (const cid of f.capability_ids) {
      const e = byId.get(cid);
      if (e && !caps[cid]) {
        caps[cid] = {
          id: e.id, kind: e.kind, label: e.label, plain: e.plain, where: e.where, source: e.source, status: e.status,
          module: e.module ? (MODULE_LABEL as Record<string, string>)[e.module] ?? e.module : null,
        };
      }
    }
  }

  const counts = countRatings(bundle.fit);
  const sent = study.current_version > 0 && bundle.requests.some((r) => r.version === study.current_version);

  return (
    <ObjectRecordPage
      backHref={ROUTES.processStudio}
      backLabel="All studies"
      title={study.name}
      reference={study.ref}
      meta={study.current_version > 0 ? `version ${study.current_version}` : undefined}
      status={<StudyStatusPill status={study.status} />}
      facts={[
        { label: "Steps mapped", value: bundle.steps.length },
        { label: "Standard or setup", value: counts.standard + counts.needs_setup },
        { label: "Need a change", value: counts.partly + counts.not_covered + counts.needs_review },
        { label: "Plan", value: `${bundle.tasks.reduce((a, t) => a + t.duration_days, 0)} working days` },
      ].filter((f) => bundle.steps.length > 0 || f.label === "Steps mapped")}
      primaryAction={
        <>
          <span id="studioSaveSlot" />
          <TourButton step={step} />
          <PrimaryAction
            studyId={study.id} step={step} reached={study.reached} canEdit={canEdit}
            hasMessages={bundle.messages.some((m) => m.role === "client")} sent={sent}
          />
        </>
      }
      menu={
        <RecordMoreMenu
          printHref={`/api/process-studio/${study.id}/pdf`}
          duplicateHref={undefined}
          adapt={{ objectType: "process_study", objectLabel: "Study", isAdmin: ctx.role === "admin" }}
          remove={canDelete ? {
            endpoint: `/api/process-studio/${study.id}`, recordName: study.name, entityLabel: "study", afterHref: ROUTES.processStudio,
          } : undefined}
        />
      }
      basePath={ROUTES.processStudy(study.id)}
      tabs={[{
        id: "study",
        label: "Study",
        content: (
          <>
            <StudioScreen bundle={bundle} step={step} canEdit={canEdit} caps={caps} />
            {step === "talk" && (
              <ObjectSections
                objectType="process_study" record={study as unknown as Record<string, unknown>} patchUrl={`/api/process-studio/${study.id}`}
                exclude={["ref", "name", "status", "plan_start_date"]}
              />
            )}
          </>
        ),
      }]}
    />
  );
}
