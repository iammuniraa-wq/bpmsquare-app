import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { account_id, type, equipment_label, complaint, asset_id, assigned_to } = body;

  if (!account_id || !type || !equipment_label || !complaint) {
    return NextResponse.json(
      { error: "account_id, type, equipment_label and complaint are required" },
      { status: 400 },
    );
  }

  // Verify account belongs to this tenant
  const { data: acct } = await supabase
    .from("accounts").select("id, territory, sales_org").eq("id", account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Generate ref: CS-YYYY-XXXX (sequential within tenant)
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("service_cases")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const ref = `CS-${year}-${seq}`;

  const { data, error } = await supabase
    .from("service_cases")
    .insert({
      tenant_id: tenantId,
      account_id,
      ref,
      type,
      status: "intake",
      equipment_label,
      complaint,
      asset_id: asset_id || null,
      assigned_to: assigned_to || null,
      intake_at: new Date().toISOString(),
      has_loaner: false,
      territory: acct.territory || null,
      sales_org: acct.sales_org || null,
    })
    .select("id, ref")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
