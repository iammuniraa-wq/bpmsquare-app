import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, fetchAllRows, insertRows, nameKey, readImportBody, summarise, type PreparedRow } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { opportunityStages, initialStage, stageDef, probabilityFor, OPPORTUNITY_SOURCES } from "@/lib/sales/opportunity";

// Data Workbench import of deals (§3b-4): creates by account NAME (the
// create-time business key, bpmsquarecore §3), stage from the tenant's own
// list (default initial), amount 0 / probability from the stage -- both are
// computed values, never imported.

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, accounts, tenant] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "opportunity"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    getTenant(),
  ]);
  const spec = buildObjectSpec("opportunities", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const stages = opportunityStages(tenant?.config);
  const stageByKey = new Map(stages.flatMap((s) => [[s.value.toLowerCase(), s.value], [s.label.toLowerCase(), s.value]]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  let refSeq = await nextMasterRefSeq(supabase, "opportunities", tenantId);

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;
    const accountId = accountByName.get(nameKey(v.account_name));
    if (!accountId) {
      outcomes.push({ rowNum, status: "failed", reason: `Account "${v.account_name}" was not found — import accounts first, or check the spelling` });
      continue;
    }
    const stage = (v.stage && stageByKey.get(String(v.stage).trim().toLowerCase())) || initialStage(stages).value;
    const closed = stageDef(stages, stage)?.is_closed === true;
    const custom = collectCustomData(values);
    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref: formatMasterRef("opportunities", refSeq++),
        account_id: accountId,
        title: v.title,
        description: v.description || null,
        stage,
        outcome: closed ? (stageDef(stages, stage)?.outcome ?? "won") : "open",
        loss_reason: v.loss_reason || null,
        loss_note: v.loss_note || null,
        expected_close: v.expected_close && /^\d{4}-\d{2}-\d{2}$/.test(v.expected_close) ? v.expected_close : null,
        amount: 0,
        currency: v.currency || null,
        probability: probabilityFor(stages, stage, null),
        source: (OPPORTUNITY_SOURCES as readonly string[]).includes(v.source) ? v.source : "other",
        competitor: v.competitor || null,
        owner_id: userId,
        team: [],
        created_by: userId,
        closed_at: closed ? new Date().toISOString() : null,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "opportunities", prepared, outcomes, {
    objectType: "opportunities", labelField: "title", actorId: user?.id, actorEmail: user?.email,
  }));
}
