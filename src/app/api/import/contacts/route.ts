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

  const spec = getObjectSpec("contacts");
  const accounts = await fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));

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
    const accountId = accountByName.get(nameKey(v.account_name));
    if (!accountId) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Account "${v.account_name}" was not found — import accounts first, or check the spelling`,
      });
      continue;
    }

    const custom = collectCustomData(values);

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        account_id: accountId,
        name: v.name,
        role: v.role ?? null,
        department: v.department ?? null,
        phone: encrypt(v.phone ?? null),
        phone2: encrypt(v.phone2 ?? null),
        phone3: encrypt(v.phone3 ?? null),
        email: encrypt(v.email ?? null),
        email2: encrypt(v.email2 ?? null),
        website: v.website ?? null,
        birthday: v.birthday ?? null,
        linkedin_url: v.linkedin_url ?? null,
        address_line1: v.address_line1 ?? null,
        address_line2: v.address_line2 ?? null,
        city: v.city ?? null,
        state: v.state ?? null,
        postal_code: v.postal_code ?? null,
        country: v.country ?? null,
        territory: v.territory ?? null,
        sales_org: v.sales_org ?? null,
        notes: v.notes ?? null,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "contacts", prepared, outcomes));
}
