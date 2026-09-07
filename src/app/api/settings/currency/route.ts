import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import { CURRENCIES, isCurrencyCode, resolveCurrency } from "@/lib/currency";
import { logChange } from "@/lib/changeLog";

// The workspace currency (TenantConfig.currency, src/lib/currency.ts).
// Admin only on both verbs: this is a workspace-wide presentation decision,
// and a wrong one reaches every quote, invoice and PDF at once.

export async function GET() {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const current = resolveCurrency(data?.config as TenantConfig | null);
  return NextResponse.json({ code: current.code, options: Object.values(CURRENCIES).map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })) });
}

// PUT { code } -- one of CURRENCY_CODES. Stored values in the database are
// never converted: this changes how figures are labelled, not what they are.
export async function PUT(request: NextRequest) {
  let tenantId, role, userId;
  try {
    ({ tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  if (!body || !isCurrencyCode(body.code)) {
    return NextResponse.json({ error: "Pick a supported currency." }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const config = (current?.config ?? {}) as TenantConfig;
  const from = resolveCurrency(config).code;

  const next: TenantConfig = { ...config, currency: body.code };
  const { error } = await admin.from("tenants").update({ config: next }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (from !== body.code) {
    await logChange(admin, {
      tenantId, objectType: "settings", objectId: "currency", objectLabel: "Workspace currency", action: "update",
      actorId: userId, changes: [{ field: "currency", from, to: body.code }],
    });
  }
  return NextResponse.json({ code: body.code });
}
