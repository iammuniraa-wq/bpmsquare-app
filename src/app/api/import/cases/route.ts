import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import {
  collectCustomData,
  fetchAllRows,
  insertRows,
  nameKey,
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

  const [fieldConfig, salesConfig, accounts, assets, { count: existingCount }] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "case"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string; territory: string | null; sales_org: string | null }>(
      supabase, "accounts", "id, name, territory, sales_org", tenantId
    ),
    fetchAllRows<{ id: string; name: string }>(supabase, "assets", "id, name", tenantId),
    supabase.from("service_cases").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);
  const spec = buildObjectSpec("cases", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a]));
  const assetByName = new Map(assets.map((a) => [nameKey(a.name), a.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  const year = new Date().getFullYear();
  let seq = (existingCount ?? 0) + 1;

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
    const account = accountByName.get(nameKey(v.account_name));
    if (!account) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Account "${v.account_name}" was not found — import accounts first`,
      });
      continue;
    }

    const assetNames = (v.asset_names ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    const assetIds: string[] = [];
    let missingAsset: string | null = null;
    for (const assetName of assetNames) {
      const id = assetByName.get(nameKey(assetName));
      if (!id) { missingAsset = assetName; break; }
      assetIds.push(id);
    }
    if (missingAsset) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Asset "${missingAsset}" was not found — import assets first, or check the spelling`,
      });
      continue;
    }

    const custom = collectCustomData(values);
    const ref = `CS-${year}-${String(seq).padStart(4, "0")}`;
    seq++;

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        account_id: account.id,
        ref,
        type: v.type,
        status: "intake",
        equipment_label: v.equipment_label,
        complaint: v.complaint,
        symptom: v.symptom ?? null,
        asset_id: assetIds[0] ?? null,
        asset_ids: assetIds,
        intake_at: new Date().toISOString(),
        has_loaner: false,
        territory: v.territory || account.territory || null,
        sales_org: v.sales_org || account.sales_org || null,
        notes: v.notes ?? null,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "service_cases", prepared, outcomes));
}
