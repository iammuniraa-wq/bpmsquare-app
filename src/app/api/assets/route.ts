import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const accountId = request.nextUrl.searchParams.get("account_id");
  let query = supabase
    .from("assets")
    .select("id, name, make, model, rating, serial")
    .eq("tenant_id", tenantId)
    .eq("is_loaner", false)
    .order("name", { ascending: true });

  if (accountId) query = query.eq("account_id", accountId);

  const { data, error } = await query;
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
  const { account_id, name, kind, make, model, rating, serial, notes, is_loaner } = body;

  if (!name || !kind) {
    return NextResponse.json({ error: "name and kind are required" }, { status: 400 });
  }

  // If account_id provided, verify it belongs to this tenant
  if (account_id) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", account_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: tenantId,
      account_id: account_id || null,
      name,
      kind,
      make: make || null,
      model: model || null,
      rating: rating || null,
      serial: serial || null,
      notes: notes || null,
      is_loaner: Boolean(is_loaner),
      loaner_status: is_loaner ? "available" : null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: asset.id }, { status: 201 });
}
