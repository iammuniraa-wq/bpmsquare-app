import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { loadActorNames } from "@/lib/actorNames";
import { getAuthUser } from "@/lib/supabase-server";
import { buildHandoverWorkbook } from "@/lib/contractProjects/handover";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { currentRevision, loadLines, loadMasters, loadProject, loadRevision, loadRevisions, needsUpdate, openProjectRequest, UUID_RE } from "@/lib/contractProjects/server";

// GET /api/contract-projects/[id]/handover?revision=<id>
//   The Excel stand-in for "send to ePROMIS": the project, its budget by line (resource and cost code) and the material list. Default
//   revision: the approved one, else the one being worked on. INTERNAL (cost and margin): an authenticated download for people who can
//   open the project, never a public or signed link. Pushing to the ERP is a later step and is not offered here.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const project = found.project;

  const wanted = new URL(request.url).searchParams.get("revision");
  const { rows: revisions } = await loadRevisions(admin, tenantId, id);
  const revision = wanted && UUID_RE.test(wanted) ? await loadRevision(admin, tenantId, id, wanted) : revisions.find((r) => r.status === "approved") ?? currentRevision(revisions);
  if (!revision) return NextResponse.json({ error: "There is no budget to export yet" }, { status: 404 });
  const lines = await loadLines(admin, tenantId, revision.id);

  const codes = [...new Set(lines.map((l) => l.cost_code).filter((c): c is string => !!c))];
  const costCodeNames = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await admin.from("erp_masters").select("code, name").eq("tenant_id", tenantId).eq("kind", "cost_code").in("code", codes.slice(i, i + 100));
    for (const r of (data ?? []) as { code: string; name: string }[]) costCodeNames.set(r.code, r.name);
  }
  const resourceNames = new Map((await loadMasters(admin, tenantId, "resource")).map((r) => [r.code, r.name]));
  const [accountRow, names] = await Promise.all([
    project.account_id ? admin.from("accounts").select("name").eq("id", project.account_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    loadActorNames(admin, tenantId, [project.manager_id]),
  ]);
  const packageCodes = new Map((await loadPackages(admin, tenantId, id)).packages.flatMap((p) => p.line_keys.map((k) => [k, p.code] as const)));
  const buffer = await buildHandoverWorkbook({
    packageCodes, project, accountName: (accountRow.data as { name?: string } | null)?.name ?? null, managerName: project.manager_id ? names.get(project.manager_id) ?? null : null,
    revision, lines, resourceNames, costCodeNames,
  });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${project.ref ?? ""} ${project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Handover file downloaded", from: null, to: `Revision ${revision.rev_no}` }],
  });
  // The "Handed over" step of the project path. Until migration 0240 is applied the column is not there and the stamp is simply skipped.
  await admin.from("contract_projects").update({ handover_sent_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
  const fileName = `${(project.ref ?? "project").replace(/[^A-Za-z0-9._-]/g, "")}-budget-rev${revision.rev_no}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
