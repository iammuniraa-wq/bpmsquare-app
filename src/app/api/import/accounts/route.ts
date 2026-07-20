import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { getObjectSpec } from "@/lib/import/schema";
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

  const spec = getObjectSpec("accounts");
  const existing = await fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId);
  const byName = new Map(existing.map((a) => [nameKey(a.name), a.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  const claimedInFile = new Set<string>();

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
    const name = v.name;
    const key = nameKey(name);

    if (byName.has(key)) {
      outcomes.push({ rowNum, status: "skipped", reason: `"${name}" already exists` });
      continue;
    }
    if (claimedInFile.has(key)) {
      outcomes.push({ rowNum, status: "skipped", reason: `"${name}" appears more than once in this file` });
      continue;
    }

    let referredBy: string | null = null;
    if (v.referred_by_account_name) {
      const referrerKey = nameKey(v.referred_by_account_name);
      referredBy = byName.get(referrerKey) ?? null;
      if (!referredBy) {
        // Only accounts already in the database have an id to point at; one created
        // earlier in this same file does not yet.
        outcomes.push({
          rowNum,
          status: "failed",
          reason: claimedInFile.has(referrerKey)
            ? `Referring account "${v.referred_by_account_name}" is also new in this file — import it first, then re-import this row`
            : `Referring account "${v.referred_by_account_name}" was not found — import it first`,
        });
        continue;
      }
    }

    const custom = collectCustomData(values);

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        name,
        type: v.type,
        address_line1: v.address_line1 ?? null,
        address_line2: v.address_line2 ?? null,
        city: v.city ?? null,
        state: v.state ?? null,
        postal_code: v.postal_code ?? null,
        country: v.country ?? null,
        phone: encrypt(v.phone ?? null),
        phone2: encrypt(v.phone2 ?? null),
        email: encrypt(v.email ?? null),
        email2: encrypt(v.email2 ?? null),
        website: v.website ?? null,
        industry: v.industry ?? null,
        employee_count: v.employee_count ?? null,
        annual_revenue: v.annual_revenue ?? null,
        territory: v.territory ?? null,
        sales_org: v.sales_org ?? null,
        gstin: encrypt(v.gstin ?? null),
        notes: v.notes ?? null,
        referred_by_account_id: referredBy,
        ...(custom ? { custom_data: custom } : {}),
      },
    });

    claimedInFile.add(key);
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "accounts", prepared, outcomes));
}
