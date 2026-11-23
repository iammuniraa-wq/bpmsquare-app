import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantHasFeature } from "@/lib/tenant";
import type { HandoverDrawingRow } from "@/lib/contractProjects/handover";
import { loadReleasedElements } from "./released";

// The handover's Drawings sheet (design section 4): the released elements of the drawings filed under the project or under the tender it came
// from, through the ONE reader of released elements. Nothing for a workspace without the register, and nothing (never an error) while its
// migration is pending, so a handover downloads exactly as before.

export async function loadDrawingsForHandover(admin: SupabaseClient, tenantId: string, project: { id: string; source_opportunity_id?: string | null }): Promise<HandoverDrawingRow[]> {
  try {
    if (!(await tenantHasFeature(admin, tenantId, "drawing_register"))) return [];
    const [byProject, byTender] = await Promise.all([
      loadReleasedElements(admin, { tenantId, projectId: project.id }),
      project.source_opportunity_id ? loadReleasedElements(admin, { tenantId, opportunityId: project.source_opportunity_id }) : Promise.resolve({ rows: [], pending: false }),
    ]);
    const seen = new Set<string>();
    const out: HandoverDrawingRow[] = [];
    for (const e of [...byProject.rows, ...byTender.rows]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ drawing_no: e.drawing_no, rev_label: e.rev_label, released_at: e.released_at, building: e.building, element_code: e.element_code, element_type: e.element_type, level: e.level, qty: e.qty, volume_m3: e.volume_m3, weight_t: e.weight_t });
    }
    return out.sort((a, b) => a.drawing_no.localeCompare(b.drawing_no) || (a.element_code ?? "").localeCompare(b.element_code ?? ""));
  } catch {
    return [];
  }
}
