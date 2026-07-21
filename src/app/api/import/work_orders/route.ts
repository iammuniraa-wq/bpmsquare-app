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

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1).toISOString();

  const [fieldConfig, salesConfig, accounts, cases, assets, quotes, { count: existingCount }] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "work_order"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "service_cases", "id, ref", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "assets", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
    supabase.from("work_orders").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).gte("created_at", yearStart).lt("created_at", yearEnd),
  ]);
  const spec = buildObjectSpec("work_orders", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const caseByRef = new Map(cases.map((c) => [nameKey(c.ref), c.id]));
  const assetByName = new Map(assets.map((a) => [nameKey(a.name), a.id]));
  const quoteByRef = new Map(quotes.map((q) => [nameKey(q.ref), q.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
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
    const accountId = accountByName.get(nameKey(v.account_name));
    if (!accountId) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Account "${v.account_name}" was not found — import accounts first`,
      });
      continue;
    }

    const quoteId = quoteByRef.get(nameKey(v.quote_ref));
    if (!quoteId) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Authorizing quote "${v.quote_ref}" was not found — import quotes first`,
      });
      continue;
    }

    let caseId: string | null = null;
    if (v.case_ref) {
      caseId = caseByRef.get(nameKey(v.case_ref)) ?? null;
      if (!caseId) {
        outcomes.push({ rowNum, status: "failed", reason: `Case "${v.case_ref}" was not found` });
        continue;
      }
    }

    let assetId: string | null = null;
    if (v.asset_name) {
      assetId = assetByName.get(nameKey(v.asset_name)) ?? null;
      if (!assetId) {
        outcomes.push({ rowNum, status: "failed", reason: `Asset "${v.asset_name}" was not found` });
        continue;
      }
    }

    const custom = collectCustomData(values);
    const ref = `WO-${now.getFullYear()}-${String(seq).padStart(4, "0")}`;
    seq++;

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        account_id: accountId,
        ref,
        case_id: caseId,
        asset_id: assetId,
        technician_id: null,
        auth_kind: "quote",
        auth_id: quoteId,
        status: "scheduled",
        scheduled_for: v.scheduled_for || null,
        description: v.description ?? null,
        notes: v.notes ?? null,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "work_orders", prepared, outcomes));
}
