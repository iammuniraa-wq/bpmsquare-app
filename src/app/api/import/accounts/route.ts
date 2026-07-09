import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const VALID_TYPES = ["prospect", "oem", "direct", "end_customer"] as const;

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { rows } = await request.json() as { rows: Record<string, string>[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  // Fetch existing account names to detect duplicates
  const { data: existing } = await supabase
    .from("accounts")
    .select("name")
    .eq("tenant_id", tenantId);
  const existingNames = new Set((existing ?? []).map((a: { name: string }) => a.name.toLowerCase().trim()));

  const toInsert: object[] = [];
  const errors: { row: number; error: string }[] = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    const name = row.name?.trim();
    if (!name) { errors.push({ row: i + 3, error: "name is required" }); return; }
    if (existingNames.has(name.toLowerCase())) { skipped++; return; }

    const type = VALID_TYPES.includes(row.type?.trim() as typeof VALID_TYPES[number])
      ? row.type.trim()
      : "prospect";

    toInsert.push({
      tenant_id: tenantId,
      name,
      type,
      city:  row.city?.trim()  || null,
      phone: row.phone?.trim() || null,
      email: row.email?.trim() || null,
      gstin: row.gstin?.trim() || null,
      notes: row.notes?.trim() || null,
    });
    existingNames.add(name.toLowerCase());
  });

  let inserted = 0;
  if (toInsert.length > 0) {
    const { error } = await supabase.from("accounts").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted = toInsert.length;
  }

  return NextResponse.json({ inserted, skipped, errors });
}
