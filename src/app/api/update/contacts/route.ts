import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";

// Mirrors src/app/api/contacts/[id]/route.ts PATCH — account_id excluded (relationship
// changes aren't supported by bulk Update in v1; it isn't a mappable column anyway).
const ALLOWED = [
  "name", "role", "department",
  "phone", "phone2", "phone3", "email", "email2",
  "website", "linkedin_url", "birthday",
  "address_line1", "address_line2", "city", "state", "postal_code", "country",
  "notes", "territory", "sales_org", "custom_data",
];
const PII_FIELDS = new Set(["phone", "phone2", "phone3", "email", "email2"]);
const DATE_FIELDS = new Set(["birthday"]);

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
    for (const key of ALLOWED) {
      if (!(key in values)) continue;
      const value = DATE_FIELDS.has(key) && values[key] === "" ? null : values[key] || null;
      patch[key] = PII_FIELDS.has(key) ? encrypt(value as string | null) : value;
    }

    if (Object.keys(patch).length === 0) {
      outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" });
      continue;
    }

    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  return NextResponse.json(await updateRows(supabase, "contacts", tenantId, prepared, outcomes));
}
