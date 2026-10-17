import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";
import { SETTABLE_STATUSES } from "@/lib/estimator/requests";

// Bulk update of estimate HEADERS, matched on real id only (section 3). Mirrors the allowlist
// of PATCH /api/estimates/[id] minus what changes the numbers: margin_pct and the input values
// recalculate the estimate, which only the estimate screen/route does (a bulk edit would leave
// the stored totals stale). "quoted" is set by the quote conversion, never by a file. Lines and
// costs are not in this object at all.
const ALLOWED = ["name", "notes", "currency", "status", "custom_data"];

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "estimates");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "estimates")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    if ("margin_pct" in values && values.margin_pct?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "Margin changes recalculate the estimate. Change it on the estimate screen" });
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) patch[key] = values[key] || null;
    if ("name" in patch && !patch.name) { outcomes.push({ rowNum, status: "failed", reason: "Name cannot be empty" }); continue; }
    if ("status" in patch) {
      if (patch.status === null) delete patch.status;
      else if (!(SETTABLE_STATUSES as readonly unknown[]).includes(patch.status)) {
        outcomes.push({ rowNum, status: "failed", reason: `Status can be set to ${SETTABLE_STATUSES.join(", ")}` });
        continue;
      }
    }
    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "estimates", tenantId, prepared, outcomes, {
    objectType: "estimates", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
