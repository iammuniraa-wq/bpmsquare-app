import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, readImportBody, summarise } from "@/lib/import/server";
import { drawingDwGate } from "@/lib/drawings/dw";
import { ensureDefaultType, listTypes } from "@/lib/drawings/server";
import { createDrawing } from "@/lib/drawings/writes";
import type { RowOutcome } from "@/lib/import/types";

// Loads an existing drawing register as DRAFTS: a number, a title, a type (by name) and an external number, one revision 0 draft each, with
// no file. It can never release or supersede anything: release is a signed-in approver's decision in the register, so a file cannot carry
// it. Every drawing is made by createDrawing, the writer the screen uses, so the number rules, the type's numbering pattern, the unique
// number and the change history are the screen's own. The type is looked up among THIS workspace's types only.

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "drawings");
  if (gate) return gate;
  const g = await drawingDwGate(supabase, tenantId, userId, role, "edit");
  if (!g.ok) return g.response;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig] = await Promise.all([getEffectiveFieldConfig(supabase, tenantId, "drawing"), getSalesConfig(supabase, tenantId)]);
  const spec = buildObjectSpec("drawings", fieldConfig, salesConfig);
  await ensureDefaultType(g.ctx.admin, tenantId);
  const { rows: types, pending } = await listTypes(g.ctx.admin, tenantId);
  if (pending) return NextResponse.json({ error: "The drawing register needs a database update (migrations 0255 and 0256). Ask your administrator to apply it." }, { status: 503 });
  const byName = new Map(types.filter((t) => t.active).map((t) => [t.name.trim().toLowerCase(), t]));

  const outcomes: RowOutcome[] = [];
  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;
    let typeId: string | undefined;
    if ((v.type_name ?? "").trim()) {
      const t = byName.get(v.type_name.trim().toLowerCase());
      if (!t) { outcomes.push({ rowNum, status: "failed", reason: `Drawing type "${v.type_name}" was not found. Add it in Settings, Drawing types, or leave the column blank` }); continue; }
      typeId = t.id;
    }
    const made = await createDrawing(g.ctx, { drawing_no: v.drawing_no, title: v.title, external_no: v.external_no || undefined, type_id: typeId, custom_data: collectCustomData(values) });
    outcomes.push(made.ok ? { rowNum, status: "inserted" } : { rowNum, status: "failed", reason: made.error });
  }
  return NextResponse.json(summarise(outcomes));
}
