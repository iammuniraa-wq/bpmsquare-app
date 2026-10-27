import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, loadRfqBundle, sendToSupplier, renderRfqPdf } from "@/lib/rfq/server";
import { rfqConfig } from "@/lib/rfq/types";
import { splitReachable, unreachableMessage } from "@/lib/rfq/reach";
import { getTenant } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";

// POST { rfq_supplier_ids?: string[], kind?: "request" | "reminder", message? }
// Sends the request (or a reminder) to the chosen recipients -- by default
// every one that hasn't been sent yet (request) or hasn't replied (reminder).
// Each supplier gets their own email, link and reply sheet; one failure
// doesn't stop the rest.

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await rfqAccess(true);
    const { id } = await params;
    const tenant = await getTenant();
    if (!tenant || tenant.id !== ctx.tenantId) return NextResponse.json({ error: "Workspace not resolved" }, { status: 400 });
    const bundle = await loadRfqBundle(ctx.admin, ctx.tenantId, id, { messages: false });
    if (!bundle) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (["closed", "cancelled"].includes(bundle.rfq.status)) return NextResponse.json({ error: "This RFQ is closed." }, { status: 409 });
    if (!bundle.lines.some((l) => l.status !== "cancelled")) return NextResponse.json({ error: "Add at least one line before sending." }, { status: 422 });

    const body = (await req.json().catch(() => ({}))) as { rfq_supplier_ids?: string[]; kind?: string; message?: string };
    const kind = body.kind === "reminder" ? "reminder" : "request";
    const chosen = Array.isArray(body.rfq_supplier_ids) && body.rfq_supplier_ids.length ? new Set(body.rfq_supplier_ids) : null;
    const targets = bundle.suppliers.filter((s) => {
      if (s.status === "cancelled") return false;
      if (chosen) return chosen.has(s.id);
      return kind === "request" ? s.status === "pending" : ["sent", "viewed"].includes(s.status);
    });
    if (!targets.length) return NextResponse.json({ error: kind === "request" ? "Everyone on this RFQ has already been sent it — add a supplier, or send a reminder." : "Nobody is waiting on a reply." }, { status: 422 });

    const results: { rfq_supplier_id: string; supplier: string; ok: boolean; reason?: string; redirected?: boolean }[] = [];
    // Sort the recipients first: a supplier with no e-mail is named, with what to do, instead of the whole send failing as a bare 502.
    const recipient = (rs: (typeof targets)[number]) => ({ rs, id: rs.id, name: rs.suppliers?.name ?? "", email: (rs.email_to || rs.suppliers?.email || "").trim() || null, phone: rs.suppliers?.phone ?? null });
    const { reachable, unreachable } = splitReachable(targets.map(recipient));
    if (unreachable.length > 0 && reachable.length === 0) {
      return NextResponse.json({
        error: unreachableMessage(unreachable, true),
        unreachable: unreachable.map((u) => ({ rfq_supplier_id: u.id, supplier: u.name, has_phone: !!u.phone?.trim() })),
        results: unreachable.map((u) => ({ rfq_supplier_id: u.id, supplier: u.name, ok: false, reason: "No email address" })),
      }, { status: 422 });
    }
    for (const u of unreachable) results.push({ rfq_supplier_id: u.id, supplier: u.name, ok: false, reason: unreachableMessage([u], false) });
    const pdf = kind === "request" && rfqConfig(tenant.config?.rfq).attach_pdf ? await renderRfqPdf(ctx.admin, tenant, bundle) : null;
    for (const { rs } of reachable) {
      const r = await sendToSupplier(ctx.admin, { tenant, bundle, rs, kind, pdf, message: typeof body.message === "string" ? body.message.slice(0, 4000) : null, actor: { id: ctx.userId, email: ctx.email } });
      results.push({ rfq_supplier_id: rs.id, supplier: rs.suppliers?.name ?? "", ok: r.ok, ...(r.ok ? { redirected: r.redirected } : { reason: r.reason }) });
    }
    const okCount = results.filter((r) => r.ok).length;
    if (okCount) {
      await logChange(ctx.admin, {
        tenantId: ctx.tenantId, objectType: "rfqs", objectId: id, objectLabel: bundle.rfq.ref, action: "update", actorId: ctx.userId, actorEmail: ctx.email,
        changes: [{ field: kind === "reminder" ? "reminder sent" : "sent", from: null, to: results.filter((r) => r.ok).map((r) => r.supplier).join(", ") }],
      });
    }
    // Nothing went out for another reason (the mail service, a disconnected mailbox): say why, never a bare status.
    const why = [...new Set(results.filter((r) => !r.ok && r.reason).map((r) => r.reason as string))].join(" ");
    return NextResponse.json({ ok: okCount > 0, results, ...(okCount ? {} : { error: why || "The email could not be sent. Try again in a moment." }) }, { status: okCount ? 200 : 502 });
  } catch (e) {
    return errorResponse(e);
  }
}
