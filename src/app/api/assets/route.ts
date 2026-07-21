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
  const {
    account_id, name, kind, make, model, rating, serial, notes, is_loaner,
    rpm, frame_type, insulation_class, connection, duty, ambient_temp,
    output_kw, stator_voltage, stator_current, excitation_voltage,
    excitation_current, frequency, custom_data,
  } = body;

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
      rpm: rpm || null,
      frame_type: frame_type || null,
      insulation_class: insulation_class || null,
      connection: connection || null,
      duty: duty || null,
      ambient_temp: ambient_temp || null,
      output_kw: output_kw || null,
      stator_voltage: stator_voltage || null,
      stator_current: stator_current || null,
      excitation_voltage: excitation_voltage || null,
      excitation_current: excitation_current || null,
      frequency: frequency || null,
      is_loaner: Boolean(is_loaner),
      loaner_status: is_loaner ? "available" : null,
      ...(custom_data && Object.keys(custom_data).length ? { custom_data } : {}),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: asset.id }, { status: 201 });
}
