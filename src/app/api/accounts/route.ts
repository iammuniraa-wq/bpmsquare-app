import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { encrypt, decrypt } from "@/lib/encryption";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getTenant } from "@/lib/tenant";
import { applyAutoOwnership } from "@/lib/coverage/resolve";
import type { Account } from "@/lib/types";

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
    referred_by_account_id, custom_data,
  } = body;

  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  // referred_by_account_id comes straight from the request body -- verify it
  // belongs to this tenant before linking it, same pattern as the invoices
  // route uses for its foreign ids. Without this, a tenant-A caller could
  // splice in a tenant-B account id and have its name resolved (no tenant
  // filter) wherever this account's referral is displayed.
  if (referred_by_account_id) {
    const { data: referrer } = await supabase.from("accounts").select("id").eq("id", referred_by_account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!referrer) return NextResponse.json({ error: "Referring account not found" }, { status: 404 });
  }

  const { data, error } = await insertWithMasterRef(supabase, "accounts", tenantId, {
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
      referred_by_account_id: referred_by_account_id || null,
      ...(custom_data && Object.keys(custom_data).length > 0 ? { custom_data } : {}),
    }, "*");

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  // Auto-ownership (Coverage) -- resolve the new account's OWNER coverage
  // and set owner_user_id, same as it will be recomputed on every future
  // update. Only queried when the tenant actually has the module on, so an
  // account create for every other tenant costs nothing extra.
  const tenant = await getTenant();
  if (tenant?.features?.coverage_model) {
    const ownerUserId = await applyAutoOwnership(tenantId, data as Account);
    (data as Account).owner_user_id = ownerUserId;
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "accounts", objectId: data.id, objectLabel: data.name,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("accounts", {}, {
      name, type, address_line1, address_line2, city, state, postal_code, country,
      phone, phone2, email, email2, website, industry, employee_count, annual_revenue,
      gstin, notes, referred_by_account_id,
    }),
  });

  return NextResponse.json(data, { status: 201 });
}
