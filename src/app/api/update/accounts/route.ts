import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { encrypt, decryptAccount } from "@/lib/encryption";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";
import type { Account } from "@/lib/types";

// Mirrors src/app/api/accounts/[id]/route.ts PATCH exactly — same fields, same PII handling.
const ALLOWED = [
  "name", "type",
  "address_line1", "address_line2", "city", "state", "postal_code", "country",
  "phone", "phone2", "email", "email2", "website",
  "industry", "employee_count", "annual_revenue", "gstin", "notes",
  "custom_data",
];
const PII_FIELDS = new Set(["phone", "phone2", "email", "email2", "gstin"]);

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

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) {
      outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    const diffPatch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (!(key in values)) continue;
      const value = values[key] || null;
      patch[key] = PII_FIELDS.has(key) ? encrypt(value) : value;
      diffPatch[key] = value;
    }

    if (Object.keys(patch).length === 0) {
      outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" });
      continue;
    }

    prepared.push({ rowNum, id, patch, diffPatch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "accounts", tenantId, prepared, outcomes, {
    objectType: "accounts", labelField: "name", actorId: user?.id, actorEmail: user?.email,
    decryptBefore: (row) => decryptAccount(row as unknown as Account) as unknown as Record<string, unknown>,
  }));
}
