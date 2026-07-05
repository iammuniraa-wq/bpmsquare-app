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
  const { account_id, name, role, phone, phone2, phone3, email } = body;

  if (!name || !account_id) {
    return NextResponse.json({ error: "name and account_id are required" }, { status: 400 });
  }

  // Verify account belongs to this tenant
  const { data: acct } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", account_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      tenant_id: tenantId,
      account_id,
      name,
      role: role || null,
      phone: phone || null,
      phone2: phone2 || null,
      phone3: phone3 || null,
      email: email || null,
    })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
