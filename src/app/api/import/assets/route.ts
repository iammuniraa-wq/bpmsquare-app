import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const VALID_KINDS = ["motor", "transformer", "pump", "generator", "panel"] as const;

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

  // Build account name → id map
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const accountMap = new Map<string, string>(
    (accounts ?? []).map((a: { id: string; name: string }) => [a.name.toLowerCase().trim(), a.id])
  );

  const toInsert: object[] = [];
  const errors: { row: number; error: string }[] = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    const name     = row.name?.trim();
    const acctName = row.account_name?.trim();
    const kind     = row.kind?.trim();

    if (!name)     { errors.push({ row: i + 3, error: "name is required" }); return; }
    if (!acctName) { errors.push({ row: i + 3, error: "account_name is required" }); return; }
    if (!kind || !VALID_KINDS.includes(kind as typeof VALID_KINDS[number])) {
      errors.push({ row: i + 3, error: `kind must be one of: ${VALID_KINDS.join(", ")}` });
      return;
    }

    const accountId = accountMap.get(acctName.toLowerCase());
    if (!accountId) {
      errors.push({ row: i + 3, error: `Account "${acctName}" not found — import accounts first` });
      return;
    }

    toInsert.push({
      tenant_id:  tenantId,
      account_id: accountId,
      name,
      kind,
      make:   row.make?.trim()   || null,
      model:  row.model?.trim()  || null,
      serial: row.serial?.trim() || null,
      rating: row.rating?.trim() || null,
      notes:  row.notes?.trim()  || null,
    });
  });

  let inserted = 0;
  if (toInsert.length > 0) {
    const { error } = await supabase.from("assets").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted = toInsert.length;
  }

  return NextResponse.json({ inserted, skipped, errors });
}
