import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailOutputFor } from "@/lib/emailOutput";
import { RFQ_LIMITS } from "./types";
import { htmlToText, stripQuotedReply, cleanResponse, type CleanResponse } from "./rules";
import { parseSubjectTag, parseReplyToAddress, mailCodeMatches } from "./token";
import { storeAttachment, saveResponses, loadTenantById, notifyRfqTeam, isMissingRelation, refreshRfqStatus } from "./server";
import { parseReplySheet } from "./sheet";

// Inbound supplier email, from any channel, normalised to one shape and
// routed to exactly one RFQ recipient. Two channels feed it:
//   platform  the inbound webhook (/api/inbound/email/[provider]); the
//             recipient address itself carries the signed route
//   mailbox   the tenant's own inbox, read by the poller; the tenant is
//             already known, and the subject tag / In-Reply-To route it
//
// The message body is UNTRUSTED data: it is stored as text, rendered escaped,
// never interpolated into HTML or a prompt as instructions.

export type InboundEmail = {
  provider: string;
  providerMessageId: string | null;
  from: string | null;
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  /** Used by the shared Inbox, not by RFQ routing: the References header and the headers that mark an auto-reply. */
  references?: string | null;
  headers?: Record<string, string>;
  attachments: { filename: string; contentType: string; content: Buffer }[];
};

export type RouteResult =
  | { ok: true; tenantId: string; rfqId: string; rfqSupplierId: string | null; duplicate: boolean; pricesSaved: number }
  | { ok: false; reason: string };

const addr = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/^.*</, "").replace(/>.*$/, "");

type Target = { tenantId: string; rfqId: string; rsId: string | null };

async function routePlatform(admin: SupabaseClient, mail: InboundEmail): Promise<Target | null> {
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain) return null;
  for (const to of mail.to) {
    const rsId = parseReplyToAddress(to, domain);
    if (!rsId) continue;
    const { data } = await admin.from("rfq_suppliers").select("id, tenant_id, rfq_id").eq("id", rsId).maybeSingle();
    if (data) return { tenantId: data.tenant_id as string, rfqId: data.rfq_id as string, rsId: data.id as string };
  }
  return null;
}

async function routeMailbox(admin: SupabaseClient, tenantId: string, mail: InboundEmail): Promise<Target | null> {
  // 1. In-Reply-To one of OUR sent messages -- the strongest signal.
  if (mail.inReplyTo) {
    const { data } = await admin.from("rfq_messages").select("rfq_id, rfq_supplier_id")
      .eq("tenant_id", tenantId).eq("message_id", mail.inReplyTo).limit(1).maybeSingle();
    if (data) return { tenantId, rfqId: data.rfq_id as string, rsId: (data.rfq_supplier_id as string | null) ?? null };
  }
  // 2. Subject tag: ref + per-recipient code.
  const tag = parseSubjectTag(mail.subject);
  if (!tag) return null;
  const { data: rfq } = await admin.from("rfqs").select("id").eq("tenant_id", tenantId).eq("ref", tag.ref).maybeSingle();
  if (!rfq) return null;
  const { data: sups } = await admin.from("rfq_suppliers").select("id, email_to, suppliers(email)").eq("tenant_id", tenantId).eq("rfq_id", rfq.id);
  const rows = (sups ?? []) as unknown as { id: string; email_to: string | null; suppliers: { email: string | null } | null }[];
  if (tag.code) {
    const hit = rows.find((r) => mailCodeMatches(r.id, tag.code!));
    if (hit) return { tenantId, rfqId: rfq.id as string, rsId: hit.id };
  }
  // 3. Ref only (a mail client stripped the code): the sender must be one of
  // this RFQ's suppliers -- or the workspace's own redirect inbox, which is
  // where a redirected request was read and answered from.
  const from = addr(mail.from);
  const bySender = rows.find((r) => addr(r.email_to) === from || addr(r.suppliers?.email) === from);
  if (bySender) return { tenantId, rfqId: rfq.id as string, rsId: bySender.id };
  const tenant = await loadTenantById(admin, tenantId);
  const out = tenant ? emailOutputFor(tenant) : null;
  if (out?.mode === "redirect" && out.redirect_to && addr(out.redirect_to) === from) {
    return { tenantId, rfqId: rfq.id as string, rsId: rows.length === 1 ? rows[0].id : null };
  }
  return null;
}

/** Route, store and act on one inbound email. Idempotent per provider
 *  message id (a webhook retry or a re-poll lands it once). */
export async function ingestInbound(admin: SupabaseClient, mail: InboundEmail, opts: { tenantId?: string } = {}): Promise<RouteResult> {
  let target: Target | null = null;
  try {
    target = opts.tenantId ? await routeMailbox(admin, opts.tenantId, mail) : await routePlatform(admin, mail);
  } catch (e) {
    if (isMissingRelation(e as { code?: string })) return { ok: false, reason: "rfq tables missing" };
    throw e;
  }
  if (!target) return { ok: false, reason: "not an RFQ reply" };
  const { tenantId, rfqId, rsId } = target;

  const providerId = (mail.providerMessageId ?? mail.messageId ?? "").slice(0, 300) || null;
  if (providerId) {
    const { data: dup } = await admin.from("rfq_messages").select("id")
      .eq("tenant_id", tenantId).eq("provider", mail.provider).eq("provider_message_id", providerId).maybeSingle();
    if (dup) return { ok: true, tenantId, rfqId, rfqSupplierId: rsId, duplicate: true, pricesSaved: 0 };
  }

  const stored = [];
  const sheets: Buffer[] = [];
  for (const f of mail.attachments.slice(0, RFQ_LIMITS.maxAttachmentsPerMessage)) {
    const a = await storeAttachment(admin, tenantId, rfqId, f);
    if (a) stored.push(a);
    if (/spreadsheetml/.test(f.contentType) || /\.xlsx$/i.test(f.filename)) sheets.push(f.content);
  }
  const raw = mail.text?.trim() ? mail.text : mail.html ? htmlToText(mail.html) : "";
  const body = stripQuotedReply(raw).slice(0, 20000);

  const { error } = await admin.from("rfq_messages").insert({
    tenant_id: tenantId, rfq_id: rfqId, rfq_supplier_id: rsId,
    direction: "in", channel: "email", from_address: mail.from, to_addresses: mail.to,
    subject: mail.subject.slice(0, 500), body_text: body, message_id: mail.messageId, in_reply_to: mail.inReplyTo,
    provider: mail.provider, provider_message_id: providerId, attachments: stored, status: "received",
  });
  if (error) {
    if (error.code === "23505") return { ok: true, tenantId, rfqId, rfqSupplierId: rsId, duplicate: true, pricesSaved: 0 };
    return { ok: false, reason: error.message };
  }

  // Our own reply sheet came back: its hidden line ids make it safe to read
  // straight into responses (every value still goes through cleanResponse).
  let pricesSaved = 0;
  if (rsId) {
    const { data: rs } = await admin.from("rfq_suppliers").select("id, status, currency").eq("id", rsId).eq("tenant_id", tenantId).maybeSingle();
    if (rs) {
      const { data: lineRows } = await admin.from("rfq_lines").select("id").eq("tenant_id", tenantId).eq("rfq_id", rfqId);
      const valid = new Set(((lineRows ?? []) as { id: string }[]).map((l) => l.id));
      const rows: CleanResponse[] = [];
      for (const buf of sheets) {
        try {
          for (const input of await parseReplySheet(buf, valid)) {
            const c = cleanResponse(input);
            if (c.ok && c.value) rows.push(c.value);
          }
        } catch { /* not our sheet, or unreadable -- the file is still attached */ }
      }
      if (rows.length) {
        pricesSaved = (await saveResponses(admin, { tenantId, rfqId, rs: rs as { id: string; status: "sent"; currency: string | null }, rows, source: "email" })).saved;
      } else if (rs.status === "sent" || rs.status === "viewed" || rs.status === "pending") {
        await admin.from("rfq_suppliers").update({ status: "replied", replied_at: new Date().toISOString(), reply_source: "email", updated_at: new Date().toISOString() })
          .eq("id", rsId).eq("tenant_id", tenantId);
      }
    }
  }

  const tenant = await loadTenantById(admin, tenantId);
  const { data: rfq } = await admin.from("rfqs").select("id, ref, title, requested_by, buyer_id").eq("id", rfqId).eq("tenant_id", tenantId).maybeSingle();
  if (tenant && rfq) {
    await refreshRfqStatus(admin, tenantId, rfqId);
    await notifyRfqTeam(admin, tenant, rfq as never, pricesSaved
      ? `prices received by email from ${mail.from ?? "a supplier"} (${pricesSaved} line${pricesSaved === 1 ? "" : "s"})`
      : `new email from ${mail.from ?? "a supplier"}`);
  }
  return { ok: true, tenantId, rfqId, rfqSupplierId: rsId, duplicate: false, pricesSaved };
}
