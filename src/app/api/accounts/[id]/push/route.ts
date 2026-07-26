import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { decryptAccount } from "@/lib/encryption";
import { pushToWebhook } from "@/lib/webhookPush";
import type { TenantConfig } from "@/lib/constants";
import type { Account } from "@/lib/types";

// On-demand push of one account to the tenant's configured external endpoint
// (see lib/webhookPush.ts) -- a rep clicking "Push to ERP" on the account
// page, not an automatic trigger.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const [{ data: account }, { data: tenantRow }] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
  ]);

  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const decrypted = decryptAccount(account as Account);
  const result = await pushToWebhook(tenantRow?.config as TenantConfig | null, "account.pushed", decrypted);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
