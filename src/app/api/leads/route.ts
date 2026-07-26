import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const SOURCES = ["oem_referral", "amc", "direct"] as const;

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { account_id, title, source } = body;

  if (!account_id) return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  if (!title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });

  // account_id comes from the request body -- verify it resolves to a row
  // this tenant actually owns before using it (per MULTI_TENANT_GUARDRAILS.md).
  const { data: account } = await supabase.from("accounts").select("id").eq("id", account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("leads")
    .insert({
      tenant_id: tenantId,
      account_id,
      title: title.trim(),
      source: SOURCES.includes(source) ? source : "direct",
      status: "new",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
