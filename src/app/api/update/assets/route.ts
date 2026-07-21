import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";

// Mirrors src/app/api/assets/[id]/route.ts PATCH — account_id excluded (relationship
// changes aren't supported by bulk Update in v1; it isn't a mappable column anyway).
const ALLOWED = [
  "name", "kind", "make", "model", "rating", "serial", "notes", "custom_data",
  "rpm", "frame_type", "insulation_class", "connection", "duty", "ambient_temp",
  "output_kw", "stator_voltage", "stator_current", "excitation_voltage",
  "excitation_current", "frequency",
];

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
    if (!id) {
      outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) patch[key] = values[key] || null;

    if (Object.keys(patch).length === 0) {
      outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" });
      continue;
    }

    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  return NextResponse.json(await updateRows(supabase, "assets", tenantId, prepared, outcomes));
}
