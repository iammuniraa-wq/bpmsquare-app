import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";

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
    account_id, name, role, department,
    phone, phone2, phone3, email, email2,
    website, linkedin_url, birthday,
    address_line1, address_line2, city, state, postal_code, country,
    notes, custom_data,
  } = body;

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
      account_id, name,
      role: role || null,
      department: department || null,
      phone: encrypt(phone || null),
      phone2: encrypt(phone2 || null),
      phone3: encrypt(phone3 || null),
      email: encrypt(email || null),
      email2: encrypt(email2 || null),
      website: website || null,
      linkedin_url: linkedin_url || null,
      birthday: birthday || null,
      address_line1: address_line1 || null,
      address_line2: address_line2 || null,
      city: city || null,
      state: state || null,
      postal_code: postal_code || null,
      country: country || null,
      notes: notes || null,
      ...(custom_data && Object.keys(custom_data).length > 0 ? { custom_data } : {}),
    })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
