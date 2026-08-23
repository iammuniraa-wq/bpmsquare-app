import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { runPrice, PricingConfigError } from "@/lib/pricing/server";
import { PricingError, DslError, type DocumentLine } from "@/lib/pricing-core";

// Cockpit test-pricing (session-auth, "pricing" workcenter view access):
// same engine as POST /api/v1/price but reachable without an API key, and
// allowed to target a DRAFT version explicitly -- that is the whole point:
// try a draft against a sample document BEFORE publishing it.
export async function POST(req: Request) {
  let tenantId: string;
  try {
    const auth = await requireTenantUser();
    const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
    if (!canViewWorkcenter(perms, "pricing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    document?: { attributes?: Record<string, unknown>; lines?: DocumentLine[] };
    options?: { pricing_date?: string; config_version?: number; pricing_area?: string; procedure?: string; currency?: string };
  } | null;
  if (!body?.document || !Array.isArray(body.document.lines) || body.document.lines.length === 0) {
    return NextResponse.json({ error: "document.lines must be a non-empty array" }, { status: 422 });
  }
  if (body.document.lines.length > 50) {
    return NextResponse.json({ error: "Test pricing is capped at 50 lines" }, { status: 422 });
  }

  try {
    const { result, config_version, procedure, calc_ms } = await runPrice(
      tenantId,
      { attributes: body.document.attributes ?? {}, lines: body.document.lines },
      {
        pricingDate: body.options?.pricing_date,
        configVersion: body.options?.config_version,
        pricingArea: body.options?.pricing_area,
        procedure: body.options?.procedure,
        currency: body.options?.currency,
      }
    );
    return NextResponse.json({ result, config_version, procedure, calc_ms });
  } catch (e) {
    if (e instanceof PricingConfigError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PricingError) return NextResponse.json({ error: `${e.code}: ${e.message}` }, { status: 422 });
    if (e instanceof DslError) return NextResponse.json({ error: `FORMULA_ERROR: ${e.message}` }, { status: 422 });
    console.error("test-price failed:", e);
    return NextResponse.json({ error: "Unexpected pricing error" }, { status: 500 });
  }
}
