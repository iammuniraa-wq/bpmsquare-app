import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { DRAWING_COLS, REVISION_COLS, isMissingSchema, listTypes, normaliseRevision } from "./server";
import { headlineRevision } from "./rules";
import type { DrawingRow, RevisionRow, RevisionStatus } from "./types";

// The read model of the drawing list: every drawing of the workspace with the revision it is "at", its type's name, where it is filed and
// how many revisions wait for release. Tenant-scoped on the admin client; a pending migration reads as `pending: true`, never a crash.

export type DrawingListRow = DrawingRow & {
  type_name: string | null;
  at_label: string | null;
  at_status: RevisionStatus | null;
  released: boolean;
  waiting: boolean;
  filed_under: string | null;
};

export async function loadDrawingList(admin: SupabaseClient, tenantId: string): Promise<{ rows: DrawingListRow[]; pending: boolean; waiting: number }> {
  const { data, error } = await readAllPages((lo, hi) => admin.from("drawings").select(DRAWING_COLS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi));
  if (error) return { rows: [], pending: isMissingSchema(error), waiting: 0 };
  const drawings = (data ?? []) as unknown as DrawingRow[];
  const { data: revData } = await readAllPages((lo, hi) => admin.from("drawing_revisions").select(REVISION_COLS).eq("tenant_id", tenantId).order("id", { ascending: true }).range(lo, hi));
  const byDrawing = new Map<string, RevisionRow[]>();
  for (const r of ((revData ?? []) as unknown as Record<string, unknown>[]).map(normaliseRevision)) byDrawing.set(r.drawing_id, [...(byDrawing.get(r.drawing_id) ?? []), r]);
  const { rows: types } = await listTypes(admin, tenantId);
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  const oppIds = [...new Set(drawings.map((d) => d.opportunity_id).filter((x): x is string => !!x))];
  const prjIds = [...new Set(drawings.map((d) => d.project_id).filter((x): x is string => !!x))];
  const [{ data: opps }, { data: prjs }] = await Promise.all([
    oppIds.length ? admin.from("opportunities").select("id, ref, title").eq("tenant_id", tenantId).in("id", oppIds.slice(0, 500)) : Promise.resolve({ data: [] }),
    prjIds.length ? admin.from("contract_projects").select("id, ref, name").eq("tenant_id", tenantId).in("id", prjIds.slice(0, 500)) : Promise.resolve({ data: [] }),
  ]);
  const oppLabel = new Map(((opps ?? []) as { id: string; ref: string | null; title: string }[]).map((o) => [o.id, o.ref ?? o.title]));
  const prjLabel = new Map(((prjs ?? []) as { id: string; ref: string | null; name: string }[]).map((p) => [p.id, p.ref ?? p.name]));

  let waiting = 0;
  const rows = drawings.map((d): DrawingListRow => {
    const revs = byDrawing.get(d.id) ?? [];
    const at = headlineRevision(revs, d.current_rev_id);
    const isWaiting = revs.some((r) => r.status === "in_review");
    if (isWaiting) waiting++;
    return {
      ...d, type_name: d.type_id ? typeName.get(d.type_id) ?? null : null, at_label: at?.rev_label ?? null, at_status: at?.status ?? null,
      released: !!d.current_rev_id, waiting: isWaiting,
      filed_under: [d.opportunity_id ? oppLabel.get(d.opportunity_id) : null, d.project_id ? prjLabel.get(d.project_id) : null].filter(Boolean).join(" / ") || null,
    };
  });
  return { rows, pending: false, waiting };
}
