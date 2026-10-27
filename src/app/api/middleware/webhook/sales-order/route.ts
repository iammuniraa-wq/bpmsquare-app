import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { PRIMARY_HOST, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { unsealSecret } from "@/lib/encryption";
import { runPull } from "@/lib/connectors/d365/server";
import { runSapPull } from "@/lib/connectors/sap_s4/server";
import { idVariants } from "@/lib/connectors/sap_s4/mapping";
import { pickOrderConnector, refreshOrderFromErp } from "@/lib/salesOrders/orderConnector";

// POST /api/middleware/webhook/sales-order   { order_ref?: string, erp_id?: string, sent_at?: string }
//
// The ERP (Dynamics 365 or SAP S/4HANA) tells BPMSquare that an order, its status, a delivery or one of its invoices changed, so the order and its documents are
// refreshed now instead of at the next hourly run (the job stays as the safety net).
//
// No session: the credential is the workspace's existing ERP webhook secret (Settings > Integrations, the same secret
// that signs what BPMSquare sends out), used the same way -- X-BPMSquare-Signature is the hex HMAC-SHA256 of the raw
// body. Nothing new to configure. The workspace is the one whose own domain the request arrived on; the body never names
// a tenant, and every lookup below carries it. Anything that does not verify -- unknown host, no secret, wrong
// signature, module off -- is the same bare 401, so the answer teaches a caller nothing about which part failed.
//
// `erp_id` is the ERP's own id of the order: a record id (GUID) for Dynamics, the sales order number for SAP. An order the ERP names
// that this workspace does not have yet is read in (one filtered pull) when the Sales orders entity is on. One refresh per order per ten seconds: a repeat inside the window answers `throttled: true`.

export const maxDuration = 60;

const UNAUTHORIZED = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const MAX_BODY = 8_192;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A SAP sales order number: digits, as SAP writes them (zero-padded or not). */
const SAP_NUMBER = /^\d{1,10}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._\-/# ]{0,99}$/;
const FRESH_MS = 10 * 60 * 1000;

function signatureOk(secret: string, raw: string, header: string | null): boolean {
  if (!secret || !header || !/^[0-9a-f]{64}$/i.test(header.trim())) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const given = Buffer.from(header.trim(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return UNAUTHORIZED();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].split(":")[0].trim().toLowerCase();
  if (!host) return UNAUTHORIZED();

  const admin = createAdminSupabase();
  const lookup = host === PRIMARY_HOST
    ? await admin.from("tenants").select("id, features, config").eq("is_demo", true).maybeSingle()
    : await admin.from("tenants").select("id, features, config").eq("custom_domain", host).maybeSingle();
  const tenant = lookup.data as { id: string; features: TenantFeatures | null; config: TenantConfig | null } | null;
  if (!tenant) return UNAUTHORIZED();

  const secret = unsealSecret(tenant.config?.integration_push?.webhook_secret) ?? "";
  if (!signatureOk(secret, raw, req.headers.get("x-bpmsquare-signature"))) return UNAUTHORIZED();
  if (!tenant.features?.sales_orders || !tenant.features?.integration_middleware) return UNAUTHORIZED();
  const tenantId = tenant.id;

  let body: { order_ref?: unknown; erp_id?: unknown; sent_at?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "Send JSON with order_ref or erp_id." }, { status: 400 }); }
  if (typeof body.sent_at === "string") {
    const t = Date.parse(body.sent_at);
    if (Number.isFinite(t) && Math.abs(Date.now() - t) > FRESH_MS) return UNAUTHORIZED();
  }
  const rawId = typeof body.erp_id === "string" ? body.erp_id.trim() : "";
  const erpId = GUID.test(rawId) ? rawId.toLowerCase() : SAP_NUMBER.test(rawId) ? rawId : null;
  const ref = typeof body.order_ref === "string" && REF.test(body.order_ref.trim()) ? body.order_ref.trim() : null;
  if (!erpId && !ref) return NextResponse.json({ error: "Send order_ref (the ERP order number) or erp_id (the ERP's record id)." }, { status: 400 });

  // Find the order among THIS workspace's own links and orders.
  let orderId: string | null = null;
  const ids = erpId ? (GUID.test(erpId) ? [erpId] : idVariants(erpId)) : [];
  if (erpId) {
    const { data } = await admin.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("entity", "sales_orders").in("external_id", ids).limit(1);
    orderId = ((data ?? []) as { object_id: string }[])[0]?.object_id ?? null;
  }
  if (!orderId && ref) {
    const { data } = await admin.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("entity", "sales_orders").eq("external_key", ref).limit(1);
    orderId = ((data ?? []) as { object_id: string }[])[0]?.object_id ?? null;
  }
  if (!orderId && erpId) {
    // New in the ERP: read just that order in (a no-op unless the entity is switched on), then look again.
    const connector = await pickOrderConnector(admin, tenantId);
    const pulled = connector.id === "sap_s4"
      ? await runSapPull(admin, tenantId, "sales_orders", { trigger: "manual", userId: null, full: true, ids: [erpId] })
      : await runPull(admin, tenantId, "sales_orders", { trigger: "manual", userId: null, full: true, select: { ids: [erpId] } });
    if (!pulled.error) {
      const { data } = await admin.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("connector_id", connector.id).eq("entity", "sales_orders").in("external_id", ids).limit(1);
      orderId = ((data ?? []) as { object_id: string }[])[0]?.object_id ?? null;
    }
  }
  if (!orderId) return NextResponse.json({ ok: false, error: "That order is not known to this workspace." }, { status: 404 });

  const r = await refreshOrderFromErp(admin, tenantId, orderId, { withHeader: true, trigger: "webhook", userId: null });
  switch (r.kind) {
    case "ok": return NextResponse.json({ ok: true, throttled: r.throttled, invoices: r.documents?.read ?? 0 });
    case "pending": return NextResponse.json({ ok: false, error: "A database update is needed first." }, { status: 503 });
    case "not_linked":
    case "missing": return NextResponse.json({ ok: false, error: "That order is not known to this workspace." }, { status: 404 });
    case "error": return NextResponse.json({ ok: false, error: r.message }, { status: 502 });
  }
}
