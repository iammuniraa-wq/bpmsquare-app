import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { encrypt, decrypt } from "@/lib/encryption";

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
    .select("id, name, type, city, state, country, phone, email, address_line1, address_line2, postal_code")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const PII = ["phone", "email"] as const;
  const decrypted = (data ?? []).map((row) => {
    const r = { ...row } as Record<string, unknown>;
    for (const f of PII) if (typeof r[f] === "string") r[f] = decrypt(r[f] as string);
    return r;
  });
  return NextResponse.json(decrypted);
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
    name, type,
    address_line1, address_line2, city, state, postal_code, country,
    phone, phone2, email, email2, website,
    industry, employee_count, annual_revenue, gstin, notes,
    referred_by_account_id, custom_data, territory, sales_org,
  } = body;

  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      tenant_id: tenantId,
      name, type,
      address_line1: address_line1 || null,
      address_line2: address_line2 || null,
      city: city || null,
      state: state || null,
      postal_code: postal_code || null,
      country: country || null,
      phone: encrypt(phone || null),
      phone2: encrypt(phone2 || null),
      email: encrypt(email || null),
      email2: encrypt(email2 || null),
      website: website || null,
      industry: industry || null,
      employee_count: employee_count || null,
      annual_revenue: annual_revenue || null,
      gstin: encrypt(gstin || null),
      notes: notes || null,
      territory: territory || null,
      sales_org: sales_org || null,
      referred_by_account_id: referred_by_account_id || null,
      ...(custom_data && Object.keys(custom_data).length > 0 ? { custom_data } : {}),
    })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
