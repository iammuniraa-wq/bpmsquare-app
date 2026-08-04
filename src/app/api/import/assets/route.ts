import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
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

  const [fieldConfig, salesConfig, accounts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "asset"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("assets", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  // Bulk ref assignment (0061): one seq query, then contiguous in-memory
  // numbering -- the partial unique index backstops concurrent imports.
  let refSeq = await nextMasterRefSeq(supabase, "assets", tenantId);

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

    // Blank account means company-owned loaner stock rather than a missing reference.
    let accountId: string | null = null;
    if (v.account_name) {
      accountId = accountByName.get(nameKey(v.account_name)) ?? null;
      if (!accountId) {
        outcomes.push({
          rowNum,
          status: "failed",
          reason: `Account "${v.account_name}" was not found — import accounts first, or leave the column blank for loaner stock`,
        });
        continue;
      }
    }

    const isLoaner = v.is_loaner === "true";
    const custom = collectCustomData(values);

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref: formatMasterRef("assets", refSeq++),
        account_id: accountId,
        name: v.name,
        kind: v.kind,
        make: v.make ?? null,
        model: v.model ?? null,
        serial: v.serial ?? null,
        rating: v.rating ?? null,
        rpm: v.rpm ?? null,
        notes: v.notes ?? null,
        is_loaner: isLoaner,
        loaner_status: isLoaner ? "available" : null,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "assets", prepared, outcomes, {
    objectType: "assets", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
