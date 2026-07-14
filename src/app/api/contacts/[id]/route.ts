import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { encrypt, decrypt, decryptContact } from "@/lib/encryption";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = [
    "name", "role", "department", "account_id",
    "phone", "phone2", "phone3", "email", "email2",
    "website", "linkedin_url", "birthday",
    "address_line1", "address_line2", "city", "state", "postal_code", "country",
    "notes", "territory", "sales_org", "custom_data",
  ];
  const PII_FIELDS = new Set(["phone", "phone2", "phone3", "email", "email2"]);
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = PII_FIELDS.has(key) ? encrypt(body[key] as string | null) : body[key];
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(decryptContact(data as import("@/lib/types").Contact));
}
