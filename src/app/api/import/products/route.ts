import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
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

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
    getEffectiveFieldConfig(supabase, tenantId, "product"),
    getSalesConfig(supabase, tenantId),
  ]);
  const spec = buildObjectSpec("products", fieldConfig, salesConfig);

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  let refSeq = await nextMasterRefSeq(supabase, "products", tenantId);

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
        ref: formatMasterRef("products", refSeq++),
        name: v.name,
        sku: v.sku ?? null,
        category: v.category ?? null,
        uom: v.uom ?? null,
        description: v.description ?? null,
        list_price: num(v.list_price),
        cost_price: num(v.cost_price),
        tax_percent: num(v.tax_percent),
        status: v.status || "active",
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "products", prepared, outcomes, {
    objectType: "products", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
