import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";

// Mirrors the PATCH allowlist of src/app/api/opportunities/[id]/route.ts
// minus the stage/outcome pair (a stage change has side effects -- outcome,
// closed_at, probability -- that belong to the PATCH route, not a bulk
// edit) and minus the computed columns. Matches by real id only (§3).
const ALLOWED = ["title", "description", "expected_close", "currency", "competitor", "loss_reason", "loss_note", "source", "custom_data"];

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) patch[key] = values[key] || null;
    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "opportunities", tenantId, prepared, outcomes, {
    objectType: "opportunities", labelField: "title", actorId: user?.id, actorEmail: user?.email,
  }));
}
