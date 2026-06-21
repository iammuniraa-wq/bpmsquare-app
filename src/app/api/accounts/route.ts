import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { name, type, city, phone, email, referred_by_account_id } = body;

  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({ tenant_id: tenantId, name, type, city: city || null, phone: phone || null, email: email || null, referred_by_account_id: referred_by_account_id || null })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
