import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canEditWorkcenter, canViewWorkcenter } from "@/lib/permissions";
import { logChange } from "@/lib/changeLog";
import { getTenant } from "@/lib/tenant";
import { sendRfqEmail } from "@/lib/pricing/rfqServer";

// One RFQ (cost-based step 2).
// GET   -- the record with its product and supplier.
// PATCH { action: "reply", value, currency?, valid_from?, valid_to?, note? }
//       -- the supplier's price becomes a CONFIRMED, product-scoped cost
//          input (source RFQ) the ladder will find on the next Fetch price.
// PATCH { action: "cancel" } / { action: "resend" }
// Reply and cancel need pricing-workcenter edit; an admin is unrestricted.

const DEFAULT_REPLY_VALIDITY_DAYS = 180;

async function auth(edit: boolean) {
  const a = await requireTenantUser();
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  if (!(edit ? canEditWorkcenter(perms, "pricing") : canViewWorkcenter(perms, "pricing"))) throw { status: 403, message: "Forbidden" };
  return a;
}

async function loadRfq(tenantId: string, id: string) {
  const { data } = await createAdminSupabase()
    .from("pricing_rfqs")
    .select("*, products(id, ref, name, uom), suppliers(id, ref, name, email)")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data as Record<string, unknown> | null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try { ({ tenantId } = await auth(false)); } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const rfq = await loadRfq(tenantId, id);
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
  return NextResponse.json({ rfq });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string, userId: string;
  try { ({ tenantId, userId } = await auth(true)); } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const rfq = await loadRfq(tenantId, id);
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const user = await getAuthUser();
  const now = new Date().toISOString();

  if (body.action === "cancel") {
    if (rfq.status === "replied") return NextResponse.json({ error: "A replied RFQ can't be cancelled — its cost input stays on file." }, { status: 409 });
    const { error } = await admin.from("pricing_rfqs").update({ status: "cancelled", updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(admin, { tenantId, objectType: "pricing_rfqs", objectId: id, objectLabel: rfq.ref as string, action: "update", actorId: userId, actorEmail: user?.email ?? null, changes: [{ field: "status", from: rfq.status as string, to: "cancelled" }] });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (body.action === "resend") {
    const supplier = rfq.suppliers as { name: string; email: string | null } | null;
    const product = rfq.products as { name: string; ref: string | null; uom: string | null };
    const tenant = await getTenant();
    if (!supplier?.email || !tenant) return NextResponse.json({ error: "No supplier email to send to." }, { status: 400 });
    const sent = await sendRfqEmail(admin, {
      tenant, tenantId, rfqId: id, rfqRef: rfq.ref as string,
      supplier: { name: supplier.name, email: supplier.email },
      product, quantity: rfq.quantity === null ? null : Number(rfq.quantity),
      message: (rfq.message as string | null) ?? null,
      actor: { id: userId, email: user?.email ?? null },
    });
    return NextResponse.json({ ok: sent.ok, sent });
  }

  if (body.action === "reply") {
    if (rfq.status === "cancelled") return NextResponse.json({ error: "This RFQ was cancelled." }, { status: 409 });
    const value = Number(body.value);
    if (!Number.isFinite(value) || value <= 0) return NextResponse.json({ error: "Enter the supplier's unit price." }, { status: 422 });
    const today = now.slice(0, 10);
    const validFrom = typeof body.valid_from === "string" && body.valid_from ? body.valid_from : today;
    const validTo = typeof body.valid_to === "string" && body.valid_to
      ? body.valid_to
      : new Date(Date.parse(validFrom) + DEFAULT_REPLY_VALIDITY_DAYS * 86_400_000).toISOString().slice(0, 10);
    if (validTo < validFrom) return NextResponse.json({ error: "Valid to must be on or after valid from." }, { status: 422 });
    const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase().slice(0, 3) : null;

    // The reply IS a cost input: product-scoped, source RFQ, confirmed, dated
    // today. The natural key (0113) makes a second reply for the same start
    // date an update, not a twin.
    const input = {
      tenant_id: tenantId, cost_model_code: rfq.cost_model_code, path: rfq.path, kind: "PURCHASE",
      value, uom: rfq.uom ?? null, currency, valid_from: validFrom, valid_to: validTo,
      source: "MANUAL", created_by: userId,
      source_code: "RFQ", quality: "confirmed", as_of: today, product_id: rfq.product_id,
    };
    const { data: ci, error: ciErr } = await admin.from("pricing_cost_inputs")
      .upsert(input, { onConflict: "tenant_id,cost_model_code,path,source_key,product_key,valid_from_key" })
      .select("id").single();
    if (ciErr) {
      // 23514 on the kind check: 0115 (PURCHASE kind) not applied yet.
      if (ciErr.code === "23514" && /kind/.test(ciErr.message)) {
        return NextResponse.json({ error: "Recording an RFQ reply needs migration 0115 applied to this database (the PURCHASE cost kind)." }, { status: 503 });
      }
      return NextResponse.json({ error: `Could not record the cost: ${ciErr.message}` }, { status: 500 });
    }

    const { error } = await admin.from("pricing_rfqs").update({
      status: "replied", reply_value: value, reply_currency: currency, reply_valid_from: validFrom, reply_valid_to: validTo,
      reply_note: typeof body.note === "string" ? body.note.slice(0, 2000) : null,
      replied_at: now, replied_by: userId, cost_input_id: ci.id, updated_at: now,
    }).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logChange(admin, {
      tenantId, objectType: "pricing_rfqs", objectId: id, objectLabel: rfq.ref as string, action: "update",
      actorId: userId, actorEmail: user?.email ?? null,
      changes: [{ field: "status", from: rfq.status as string, to: "replied" }, { field: "reply_value", from: null, to: value }],
    });
    return NextResponse.json({ ok: true, status: "replied", cost_input_id: ci.id, valid_from: validFrom, valid_to: validTo });
  }

  return NextResponse.json({ error: "Unknown action — supported: reply, cancel, resend" }, { status: 422 });
}
