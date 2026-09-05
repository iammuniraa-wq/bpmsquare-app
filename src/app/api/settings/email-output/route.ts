import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig, EmailOutputConfig } from "@/lib/constants";
import { emailOutputFor } from "@/lib/emailOutput";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/settings/email-output — the effective channel, including whether
// redirect is forced (demo workspace). Admin only: the redirect inbox is an
// internal address.
export async function GET() {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("is_demo, config").eq("id", tenantId).maybeSingle();
  return NextResponse.json(emailOutputFor({ is_demo: data?.is_demo as boolean | null, config: data?.config as TenantConfig | null }));
}

// PUT /api/settings/email-output — { mode, redirect_to }. On a demo
// workspace the mode is ignored (always redirect); only the inbox is saved.
export async function PUT(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Partial<EmailOutputConfig> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("is_demo, config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const isDemo = current?.is_demo === true;
  const config = (current?.config ?? {}) as TenantConfig;
  const existing = config.email_output ?? { mode: "partners" as const, redirect_to: "" };

  const redirect_to = typeof body.redirect_to === "string" ? body.redirect_to.trim().toLowerCase() : existing.redirect_to;
  if (redirect_to && !EMAIL_RE.test(redirect_to)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }
  let mode = body.mode === "redirect" || body.mode === "partners" ? body.mode : existing.mode;
  if (isDemo) mode = "redirect";
  if (mode === "redirect" && !redirect_to) {
    return NextResponse.json({ error: "Redirect needs an address to send everything to." }, { status: 400 });
  }

  const next: TenantConfig = { ...config, email_output: { mode, redirect_to } };
  const { error } = await admin.from("tenants").update({ config: next }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(emailOutputFor({ is_demo: isDemo, config: next }));
}
