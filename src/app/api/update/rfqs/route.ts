import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";

// Bulk update of RFQ headers, matched on real id only (§3). Mirrors the
// header allowlist of PATCH /api/rfqs/[id]; status, origin and ref are the
// flow's, never a file's. rfqs is select-only under RLS, so the write runs
// on the service-role client -- updateRows chains .eq("tenant_id") on every
// row, which is what keeps a foreign id from matching anything.
const ALLOWED = ["title", "respond_by", "required_by", "delivery_terms", "currency", "notes_to_supplier", "notes_internal", "custom_data"];

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "rfqs");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "rfqs")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) patch[key] = values[key] || null;
    if ("title" in patch && !patch.title) { outcomes.push({ rowNum, status: "failed", reason: "Title can't be empty" }); continue; }
    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch });
  }
  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(createAdminSupabase(), "rfqs", tenantId, prepared, outcomes, {
    objectType: "rfqs", labelField: "title", actorId: user?.id, actorEmail: user?.email,
  }));
}
