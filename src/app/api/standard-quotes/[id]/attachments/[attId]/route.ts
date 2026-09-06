import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

// Download one attachment: a 5-minute signed URL on the private bucket,
// issued only after the row is confirmed to be this tenant's.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }
  const { id, attId } = await params;
  const admin = createAdminSupabase();
  const { data: att } = await admin.from("standard_quote_attachments")
    .select("storage_path, file_name").eq("id", attId).eq("standard_quote_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  const { data: signed, error } = await admin.storage.from("quote-attachments").createSignedUrl(att.storage_path, 300, { download: att.file_name });
  if (error || !signed?.signedUrl) return NextResponse.json({ error: error?.message ?? "Could not sign the download" }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
