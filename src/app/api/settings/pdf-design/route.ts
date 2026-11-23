import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { describePdfDesign, sanitizePdfDesign } from "@/lib/pdf/design";
import type { PdfDesign, TenantConfig } from "@/lib/constants";

// GET / PUT /api/settings/pdf-design -- the page frame of the workspace's PDFs, held in tenants.config.pdf_design (PDF design,
// slice 1). PUT takes { design: PdfDesign | null }: null removes the frame (back to the standard look), anything else is
// validated field by field (sanitizePdfDesign) before it is stored. Admin only in both directions. No secret lives in it.

async function guard() {
  const ctx = await requireTenantUser();
  if (ctx.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
  return ctx;
}
const fail = (e: unknown) => {
  const err = e as { status?: number; message: string };
  return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
};

export async function GET() {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e) { return fail(e); }
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).single();
  const config = (data?.config ?? {}) as Partial<TenantConfig>;
  return NextResponse.json({ design: config.pdf_design ? sanitizePdfDesign(config.pdf_design) : null });
}

export async function PUT(request: NextRequest) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e) { return fail(e); }
  const body = (await request.json().catch(() => null)) as { design?: unknown } | null;
  if (!body || !("design" in body)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  let next: PdfDesign | null = null;
  if (body.design !== null) {
    next = sanitizePdfDesign(body.design);
    if (!next) return NextResponse.json({ error: "The design is not valid" }, { status: 422 });
  }

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const config = (current?.config ?? {}) as Partial<TenantConfig> & Record<string, unknown>;
  const before = config.pdf_design ? sanitizePdfDesign(config.pdf_design) : null;
  const { pdf_design: _old, ...rest } = config;
  const { error } = await admin.from("tenants").update({ config: next ? { ...rest, pdf_design: next } : rest }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    await logChange(supabase, {
      tenantId, objectType: "tenants", objectId: tenantId, objectLabel: "PDF documents: page frame", action: "update",
      actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Page frame", from: describePdfDesign(before), to: describePdfDesign(next) }],
    });
  }
  return NextResponse.json({ design: next });
}
