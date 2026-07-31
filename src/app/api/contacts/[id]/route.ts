import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { encrypt, decrypt, decryptContact } from "@/lib/encryption";
import { diffForLog, logChange } from "@/lib/changeLog";

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
  const DATE_FIELDS = new Set(["birthday"]);
  const patch: Record<string, unknown> = {};
  const patchPlaintext: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) {
      const value = DATE_FIELDS.has(key) && body[key] === "" ? null : body[key];
      patch[key] = PII_FIELDS.has(key) ? encrypt(value as string | null) : value;
      patchPlaintext[key] = value;
    }
  }

  const { data: before } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  const beforePlaintext = before ? decryptContact(before as import("@/lib/types").Contact) as unknown as Record<string, unknown> : {};

  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateTag("accounts", { expire: 0 });

  const user = await getAuthUser();
  const changes = diffForLog("contacts", beforePlaintext, patchPlaintext);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "contacts", objectId: id, objectLabel: (data as { name?: string }).name ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(decryptContact(data as import("@/lib/types").Contact));
}
