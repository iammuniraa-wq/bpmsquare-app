import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";

// scheduled_for is editable:false in FIELD_REGISTRY.work_order — excluded here too.
const ALLOWED = ["description", "notes", "custom_data"];

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
  return NextResponse.json(await updateRows(supabase, "work_orders", tenantId, prepared, outcomes));
}
