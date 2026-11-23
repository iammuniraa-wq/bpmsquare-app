import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import type { QueryableField } from "@/lib/api/query";

// The v1 shape of a drawing: the header and the RELEASED revision only (what the rest of the business may rely on). Deliberately absent from
// every select here and from the field list: the stored file's path and fingerprint, ACC item and version ids, a draft's or in-review
// revision's anything, who submitted or released (names are the workspace's own), return reasons and notes. No file bytes ever leave on the
// API: a consumer asks the workspace for the file. Tenant-scoped on the admin client.

export const DRAWING_API_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "drawing_no", type: "string", searchable: true },
  { path: "external_no", type: "string", searchable: true },
  { path: "title", type: "string", searchable: true },
  { path: "type", type: "string" },
  { path: "released", type: "boolean" },
  { path: "released_rev", type: "string" },
  { path: "released_at", type: "date" },
  { path: "effective_from", type: "date" },
  { path: "opportunity_id", type: "string" },
  { path: "project_id", type: "string" },
  { path: "created_at", type: "date" },
  { path: "updated_at", type: "date" },
];

type D = { id: string; ref: string | null; drawing_no: string; external_no: string | null; title: string; type_id: string | null; opportunity_id: string | null; project_id: string | null; current_rev_id: string | null; created_at: string; updated_at: string };
type R = { id: string; rev_label: string; released_at: string | null; effective_from: string | null };

export async function loadDrawingsForApi(admin: SupabaseClient, tenantId: string, onlyId?: string): Promise<Record<string, unknown>[]> {
  const { data } = await readAllPages((lo, hi) => {
    let q = admin.from("drawings").select("id, ref, drawing_no, external_no, title, type_id, opportunity_id, project_id, current_rev_id, created_at, updated_at").eq("tenant_id", tenantId).is("archived_at", null);
    if (onlyId) q = q.eq("id", onlyId);
    return q.order("drawing_no", { ascending: true }).order("id", { ascending: true }).range(lo, hi);
  });
  const drawings = (data ?? []) as unknown as D[];
  if (drawings.length === 0) return [];
  const releasedIds = drawings.map((d) => d.current_rev_id).filter((x): x is string => !!x);
  const { data: revs } = releasedIds.length ? await admin.from("drawing_revisions").select("id, rev_label, released_at, effective_from").eq("tenant_id", tenantId).eq("status", "released").in("id", releasedIds.slice(0, 1000)) : { data: [] };
  const rev = new Map(((revs ?? []) as unknown as R[]).map((r) => [r.id, r]));
  const { data: types } = await admin.from("drawing_types").select("id, name").eq("tenant_id", tenantId);
  const typeName = new Map(((types ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  return drawings.map((d) => {
    const r = d.current_rev_id ? rev.get(d.current_rev_id) : undefined;
    return {
      id: d.id, ref: d.ref, drawing_no: d.drawing_no, external_no: d.external_no, title: d.title, type: d.type_id ? typeName.get(d.type_id) ?? null : null,
      released: !!r, released_rev: r?.rev_label ?? null, released_at: r?.released_at ?? null, effective_from: r?.effective_from ?? null,
      opportunity_id: d.opportunity_id, project_id: d.project_id, created_at: d.created_at, updated_at: d.updated_at,
      _links: { self: `/api/v1/drawings/${d.id}` },
    };
  });
}
