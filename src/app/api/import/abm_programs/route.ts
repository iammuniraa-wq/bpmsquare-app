import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, insertRows, readImportBody, summarise, type PreparedRow } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { NORMALISE } from "@/lib/abm/dw";
import { DEFAULT_REQUIRED_ROLES } from "@/lib/abm/types";

// Data Workbench import of programs (docs/abm-architecture.md section 10). A program is born as a
// draft owned by the person importing; the owner is changed on the record. Target lists are the
// separate "ABM target accounts" object.
const PICK = ["kind", "goal_metric", "goal_target", "starts_on", "ends_on", "default_tier"] as const;

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_programs");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "abm_program"),
    getSalesConfig(supabase, tenantId),
  ]);
  const spec = buildObjectSpec("abm_programs", fieldConfig, salesConfig);

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  let refSeq = await nextMasterRefSeq(supabase, "abm_programs", tenantId);

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;
    const record: Record<string, unknown> = {};
    let failed: string | null = null;
    for (const key of PICK) {
      if (!(key in v)) continue;
      const n = NORMALISE[key](v[key] ?? "");
      if (!n.ok) { failed = n.reason; break; }
      record[key] = n.value;
    }
    if (failed) { outcomes.push({ rowNum, status: "failed", reason: failed }); continue; }
    if (record.starts_on && record.ends_on && (record.ends_on as string) < (record.starts_on as string)) {
      outcomes.push({ rowNum, status: "failed", reason: "The program cannot end before it starts" });
      continue;
    }
    const custom = collectCustomData(values);
    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref: formatMasterRef("abm_programs", refSeq++),
        name: String(v.name).trim().slice(0, 160),
        goal: v.goal ? String(v.goal).trim().slice(0, 400) : null,
        status: "draft",
        owner_user_id: userId,
        required_roles: DEFAULT_REQUIRED_ROLES,
        created_by: userId,
        ...record,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "abm_programs", prepared, outcomes, {
    objectType: "abm_programs", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
