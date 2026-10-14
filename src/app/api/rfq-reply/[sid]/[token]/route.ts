import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { resolveReply, ownResponses, ownHeader } from "@/lib/rfq/publicReply";
import { saveResponses, notifyRfqTeam } from "@/lib/rfq/server";
import { cleanResponse, type CleanResponse, type ResponseInput } from "@/lib/rfq/rules";
import { RFQ_LIMITS } from "@/lib/rfq/types";

// The supplier's no-login reply API. The credential is the signed link
// (lib/rfq/publicReply.ts resolves and checks it); nothing in the body can
// choose a tenant, an RFQ or a line outside the one the link is for.
//
// GET                                   -- what the reply page shows
// POST { action: "viewed" }             -- the page was opened by a person (a
//                                          POST, so a mail scanner's prefetch
//                                          never marks it)
// POST { action: "submit", rows, header?, declined? }
// POST { action: "message", body }      -- a question for the buyer

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sid: string; token: string }> }) {
  const { sid, token } = await params;
  const admin = createAdminSupabase();
  const ctx = await resolveReply(admin, sid, token);
  if (!ctx.ok) return NextResponse.json({ error: ctx.reason }, { status: ctx.reason === "expired" ? 410 : 404 });
  return NextResponse.json({ view: ctx.view, open: ctx.open, responses: ownResponses(ctx), header: ownHeader(ctx) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sid: string; token: string }> }) {
  const { sid, token } = await params;
  const admin = createAdminSupabase();
  const ctx = await resolveReply(admin, sid, token);
  if (!ctx.ok) return NextResponse.json({ error: ctx.reason === "expired" ? "This link has expired. Please contact the buyer for a new one." : "This link is no longer valid." }, { status: ctx.reason === "expired" ? 410 : 404 });
  const tenantId = ctx.tenant.id;
  const rfqId = ctx.bundle.rfq.id;
  const body = (await req.json().catch(() => ({}))) as { action?: string; rows?: ResponseInput[]; header?: Record<string, unknown>; declined?: boolean; body?: string };
  const now = new Date().toISOString();

  if (body.action === "viewed") {
    if (ctx.rs.status === "sent" || ctx.rs.status === "pending") {
      await admin.from("rfq_suppliers").update({ status: "viewed", viewed_at: now, updated_at: now }).eq("id", ctx.rs.id).eq("tenant_id", tenantId);
    }
    return NextResponse.json({ ok: true });
  }

  if (!ctx.open) return NextResponse.json({ error: "This request is closed — replies are no longer accepted." }, { status: 409 });

  // A per-recipient cap stands in for a rate limiter, which public routes
  // don't have.
  const { count } = await admin.from("rfq_messages").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("rfq_supplier_id", ctx.rs.id).eq("channel", "portal");
  if ((count ?? 0) >= RFQ_LIMITS.maxSubmissionsPerSupplier) return NextResponse.json({ error: "Too many submissions on this link. Please contact the buyer." }, { status: 429 });

  if (body.action === "message") {
    const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
    if (!text) return NextResponse.json({ error: "Write a message." }, { status: 422 });
    await admin.from("rfq_messages").insert({
      tenant_id: tenantId, rfq_id: rfqId, rfq_supplier_id: ctx.rs.id, direction: "in", channel: "portal",
      from_address: ctx.rs.email_to ?? ctx.rs.suppliers?.email ?? null, subject: "Message from the reply page", body_text: text, status: "received",
    });
    await notifyRfqTeam(admin, ctx.tenant, ctx.bundle.rfq, `${ctx.rs.suppliers?.name ?? "A supplier"} sent a message`);
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "submit") return NextResponse.json({ error: "Unknown action" }, { status: 422 });

  const rows: CleanResponse[] = [];
  const lineIds = new Set(ctx.view.lines.map((l) => l.id));
  for (const [i, input] of (Array.isArray(body.rows) ? body.rows : []).slice(0, RFQ_LIMITS.maxLines).entries()) {
    if (!input || typeof input.rfq_line_id !== "string" || !lineIds.has(input.rfq_line_id)) continue;
    const c = cleanResponse(input);
    if (!c.ok) return NextResponse.json({ error: `Line ${i + 1}: ${c.error}` }, { status: 422 });
    if (c.value) rows.push(c.value);
  }
  const declined = body.declined === true;
  if (!declined && rows.length === 0) return NextResponse.json({ error: "Enter a price for at least one line, or tell us you can't quote." }, { status: 422 });

  const h = body.header ?? {};
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const freight = h.freight_amount === undefined || h.freight_amount === null || h.freight_amount === "" ? null : Number(h.freight_amount);
  if (freight !== null && (!Number.isFinite(freight) || freight < 0 || freight > RFQ_LIMITS.maxPrice)) return NextResponse.json({ error: "Freight must be a positive number." }, { status: 422 });
  const header = {
    supplier_quote_ref: s(h.supplier_quote_ref, 80),
    currency: typeof h.currency === "string" && /^[A-Za-z]{3}$/.test(h.currency.trim()) ? h.currency.trim().toUpperCase() : null,
    incoterm: s(h.incoterm, 40),
    freight_amount: freight,
    payment_terms: s(h.payment_terms, 200),
    valid_until: typeof h.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.valid_until) ? h.valid_until : null,
    note: s(h.note, 2000),
  };

  const res = await saveResponses(admin, { tenantId, rfqId, rs: ctx.rs, rows, source: "link", header, declined });
  await admin.from("rfq_messages").insert({
    tenant_id: tenantId, rfq_id: rfqId, rfq_supplier_id: ctx.rs.id, direction: "in", channel: "portal",
    from_address: ctx.rs.email_to ?? ctx.rs.suppliers?.email ?? null,
    subject: declined ? "Declined to quote" : "Prices submitted",
    body_text: declined ? (header.note ?? "The supplier can't quote this request.") : `${res.saved} line(s) priced${header.note ? `\n\n${header.note}` : ""}`,
    status: "received",
  });
  await notifyRfqTeam(admin, ctx.tenant, ctx.bundle.rfq, declined
    ? `${ctx.rs.suppliers?.name ?? "A supplier"} declined to quote`
    : `${ctx.rs.suppliers?.name ?? "A supplier"} submitted prices (${res.saved} line${res.saved === 1 ? "" : "s"})`);
  return NextResponse.json({ ok: true, saved: res.saved });
}
