import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { fetchAllRows, nameKey } from "@/lib/import/server";
import { openProjectRequest, currentRevision, loadLines, loadProject, loadRevisions, type ProjectCtx } from "@/lib/contractProjects/server";
import { lineMemberships } from "@/lib/contractProjects/allocation";
import { assignLineKeys, workingRevision, type AllocationCtx } from "@/lib/contractProjects/allocationServer";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { buildingOfLine, type BuildingItem } from "@/lib/elements/buildings";
import { budgetUses } from "@/lib/elements/quantity";
import { buildingsOn } from "@/lib/elements/server";

// Shared by the project_budget_lines and project_wbs_items Data Workbench routes (docs/design/pcbs-buildings-elements.md section 2.7). The gate is the
// one every contract-project route uses (the module, the caller's grant, the workspace) plus the object's own feature (the Buildings add-on); every
// lookup is on the workspace; a project, a line or an item of another workspace simply is not there.

/** The gate of a Data Workbench route on a project object: 404 without the module or the add-on, 403 without the grant. */
export async function projectDwGate(object: "project_budget_lines" | "project_wbs_items", write: boolean): Promise<{ ok: true; req: ProjectCtx } | { ok: false; response: Response }> {
  const open = await openProjectRequest({ write });
  if (!open.ok) return { ok: false, response: NextResponse.json({ error: open.error }, { status: open.status }) };
  const off = await assertObjectFeature(open.req.tenantId, object);
  if (off) return { ok: false, response: off };
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { ok: true, req: open.req };
}

/** The projects of the workspace by reference (case and spacing ignored). */
export async function projectsByRef(admin: SupabaseClient, tenantId: string): Promise<{ byRef: Map<string, string>; refOf: Map<string, string | null> }> {
  const rows = await fetchAllRows<{ id: string; ref: string | null }>(admin, "contract_projects", "id, ref", tenantId);
  return { byRef: new Map(rows.filter((r) => r.ref).map((r) => [nameKey(r.ref as string), r.id])), refOf: new Map(rows.map((r) => [r.id, r.ref])) };
}

/** An AllocationCtx for one project of this workspace, or null when it is not there. */
export async function allocationFor(req: ProjectCtx, projectId: string): Promise<AllocationCtx | null> {
  const found = await loadProject(req.admin, req.tenantId, projectId);
  return found.kind === "ok" ? { req, project: found.project } : null;
}

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Every budget line of every project: the open draft revision, else the approved one, with the real id and the element fields. No cost anywhere. */
export async function exportProjectLines(req: ProjectCtx): Promise<Record<string, string>[]> {
  const { admin, tenantId } = req;
  const projects = await projectsByRef(admin, tenantId);
  const out: Record<string, string>[] = [];
  for (const [projectId, ref] of projects.refOf) {
    const revisions = await loadRevisions(admin, tenantId, projectId);
    const revision = currentRevision(revisions.rows);
    if (!revision) continue;
    const have = await loadPackages(admin, tenantId, projectId);
    if (have.pending) continue;
    const items: BuildingItem[] = have.packages.map((p) => ({ id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual === true, owner_employee_id: p.owner_employee_id, building_code: p.building_code ?? null }));
    const memberships = lineMemberships(have.packages);
    for (const l of await loadLines(admin, tenantId, revision.id)) {
      const where = buildingOfLine(items, memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] });
      out.push({
        id: l.id, project_ref: s(ref), revision: s(revision.rev_no), line_key: l.line_key, line_no: s(l.line_no), item_no: s(l.wbs), description: l.description, unit: s(l.unit),
        building_code: where.kind === "one" ? where.code : "", element_type: s(l.element_type), element_code: s(l.element_code), client_qty: s(l.client_qty), model_qty: s(l.model_qty),
        quantity: s(l.qty), budget_uses: l.model_qty == null ? "" : budgetUses({ qty: l.qty, client_qty: l.client_qty ?? null, model_qty: l.model_qty, client_rate: l.client_rate }) === "model" ? "Model" : "Client",
      });
    }
  }
  return out;
}

/** The budget line of a Record ID: its project, revision and stable key, matched on the workspace. */
export async function lineOfId(admin: SupabaseClient, tenantId: string, id: string): Promise<{ id: string; project_id: string; revision_id: string; line_key: string } | null> {
  const { data } = await admin.from("project_budget_lines").select("id, project_id, revision_id, line_key").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return (data as { id: string; project_id: string; revision_id: string; line_key: string } | null) ?? null;
}

/** Puts a budget line in a building of its project: the building must be a leaf (a building with activities names one of them by its WBS code instead). */
export async function putLineInBuilding(ctx: AllocationCtx, lineKey: string, buildingCode: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const have = await loadPackages(ctx.req.admin, ctx.req.tenantId, ctx.project.id);
  const building = have.packages.find((p) => p.building_code === buildingCode);
  if (!building) return { ok: false, error: `Building ${buildingCode} does not exist on this project. Add it in Project WBS items first` };
  if (have.packages.some((p) => p.parent_id === building.id)) return { ok: false, error: `${buildingCode} has activities. Put the line in one of them from the WBS tab` };
  const work = await workingRevision(ctx);
  if (!work.ok) return { ok: false, error: work.error };
  const done = await assignLineKeys(ctx, work.work, [lineKey], building.id);
  return done.ok ? { ok: true } : { ok: false, error: done.error };
}
