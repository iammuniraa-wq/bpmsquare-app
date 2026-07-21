import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import {
  collectCustomData,
  insertRows,
  readImportBody,
  summarise,
  type PreparedRow,
} from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";

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

  const [fieldConfig, salesConfig] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "supplier"),
    getSalesConfig(supabase, tenantId),
  ]);
  const spec = buildObjectSpec("suppliers", fieldConfig, salesConfig);

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
      });
      continue;
    }

    const v = validated.values;
    const custom = collectCustomData(values);

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        name: v.name,
        type: v.type || "vendor",
        city: v.city ?? null,
        phone: v.phone ?? null,
        email: v.email ?? null,
        gstin: v.gstin ?? null,
        notes: v.notes ?? null,
        status: v.status || "active",
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "suppliers", prepared, outcomes));
}
