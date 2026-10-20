import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { decrypt, encrypt } from "@/lib/encryption";
import { EVENTS } from "@/lib/events/catalog";
import { emitEvent } from "@/lib/events/emit";
import { recordConsent } from "@/lib/marketing/consentWrite";
import { isSchemaPending } from "@/lib/marketing/pending";
import { loadIdentityByKey, whatsappEnabled } from "./identity";
import { normalisePhone, phoneBlindIndex } from "./phone";
import { getProvider, type HeaderReader, type InboundItem, type WhatsAppProvider } from "./provider";
import { classifyKeyword } from "./rules";

// The inbound webhook (POST /api/inbound/whatsapp/[key]), skeleton level, provider-agnostic.
//
// Who is the tenant? The `[key]` in the URL names a stored whatsapp_identities row (random, 24 characters), and
// the tenant is that row's tenant_id. NOTHING in the request body is ever read as a tenant, contact, template
// or message id. The key alone is not a credential: the request must also carry the provider's signature, made
// with the secret stored (encrypted) on the same row, and the signature is checked over the RAW body before
// the body is parsed.
//
// What it does with a verified request:
//   - a status callback moves one of OUR messages forward (sent, delivered, read, failed), never backwards;
//   - a message from a number we hold a hash for is stored and becomes `whatsapp.replied`;
//   - STOP (or the Arabic words) writes a withdrawal to the consent ledger (source provider_webhook) and
//     emits `whatsapp.opted_out`; START records the opt-in again;
//   - a message from a number we cannot match creates NOTHING (no contact from an unsolicited message).
// Always 200 for a verified request we choose not to act on, so the provider does not retry it forever.

export type InboundRequest = { key: string; headers: HeaderReader; rawBody: string };
export type InboundResponse = { status: number; body: Record<string, unknown> };

export type InboundDeps = { provider?: WhatsAppProvider; now?: () => Date };

const MAX_BODY = 512 * 1024;
const MAX_ITEMS = 100;
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

const respond = (status: number, body: Record<string, unknown>): InboundResponse => ({ status, body });

export async function handleInbound(admin: SupabaseClient, req: InboundRequest, deps: InboundDeps = {}): Promise<InboundResponse> {
  try {
    if (req.rawBody.length > MAX_BODY) return respond(413, { error: "Too large" });
    const identity = await loadIdentityByKey(admin, req.key);
    if (!identity || identity.status !== "active") return respond(404, { error: "Not found" });
    const tenantId = identity.tenant_id;

    const { data: tenant } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
    if (!tenant || !whatsappEnabled((tenant as { features: Partial<TenantFeatures> | null }).features)) return respond(404, { error: "Not found" });

    const provider = deps.provider ?? getProvider(identity.provider);
    const secret = decrypt(identity.credentials?.webhook_secret);
    if (!provider || !secret) return respond(503, { error: "Webhook is not configured" });
    if (!provider.verifyWebhook(req.headers, req.rawBody, secret)) return respond(401, { error: "Invalid signature" });

    let items: InboundItem[];
    try { items = provider.parseWebhook(req.rawBody).slice(0, MAX_ITEMS); } catch { return respond(400, { error: "Bad payload" }); }

    const counts = { replied: 0, opted_out: 0, opted_in: 0, status: 0, ignored: 0, duplicate: 0 };
    for (const item of items) {
      const r = item.kind === "status" ? await applyStatus(admin, tenantId, item) : await applyMessage(admin, tenantId, item);
      counts[r]++;
    }
    return respond(200, { ok: true, ...counts });
  } catch (e) {
    console.error("[whatsapp inbound] failed", e);
    return respond(500, { error: "Processing failed" });
  }
}

async function applyStatus(admin: SupabaseClient, tenantId: string, s: Extract<InboundItem, { kind: "status" }>): Promise<"status" | "ignored"> {
  const { data } = await admin.from("whatsapp_messages")
    .select("id, status, contact_id, account_id, template_id, lang").eq("tenant_id", tenantId).eq("provider_message_id", s.providerMessageId).eq("direction", "out").maybeSingle();
  const m = data as { id: string; status: string; contact_id: string | null; account_id: string | null; template_id: string | null; lang: string | null } | null;
  if (!m) return "ignored";
  const current = RANK[m.status] ?? -1;
  if (s.status === "failed") {
    // A message already delivered or read cannot fail afterwards.
    if (current >= RANK.delivered) return "ignored";
  } else if ((RANK[s.status] ?? 0) <= current) return "ignored";

  const patch: Record<string, unknown> = { status: s.status };
  if (s.status === "delivered") patch.delivered_at = s.at;
  if (s.status === "read") patch.read_at = s.at;
  if (s.status === "failed") patch.error = s.error ?? "Failed at the provider";
  await admin.from("whatsapp_messages").update(patch).eq("id", m.id).eq("tenant_id", tenantId);

  const name = s.status === "delivered" ? EVENTS.WHATSAPP_DELIVERED : s.status === "read" ? EVENTS.WHATSAPP_READ : s.status === "failed" ? EVENTS.WHATSAPP_FAILED : null;
  if (name) {
    await emitEvent(tenantId, {
      name, object_type: "whatsapp_template", object_id: m.template_id, source: "provider_webhook", occurred_at: s.at,
      contact_id: m.contact_id, account_id: m.account_id, lang: m.lang, key: `${m.id}:${s.status}`, payload: { message_id: m.id },
    }, admin);
  }
  return "status";
}

async function applyMessage(admin: SupabaseClient, tenantId: string, msg: Extract<InboundItem, { kind: "message" }>): Promise<"replied" | "opted_out" | "opted_in" | "ignored" | "duplicate"> {
  const e164 = normalisePhone(msg.from.startsWith("+") ? msg.from : `+${msg.from.replace(/\D/g, "")}`);
  if (!e164) return "ignored";
  let hash: string;
  try { hash = phoneBlindIndex(e164); } catch (e) { console.error("[whatsapp inbound]", (e as Error).message); return "ignored"; }

  const { data: found } = await admin.from("whatsapp_numbers").select("contact_id").eq("tenant_id", tenantId).eq("phone_hash", hash).order("created_at", { ascending: false }).limit(1);
  const contactId = ((found ?? []) as { contact_id: string }[])[0]?.contact_id;
  if (!contactId) return "ignored";
  const { data: c } = await admin.from("contacts").select("id, account_id").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
  const contact = c as { id: string; account_id: string } | null;
  if (!contact) return "ignored";

  // A provider retries until it is answered; the unique index catches a race, this catches the ordinary replay.
  const seen = await admin.from("whatsapp_messages").select("id").eq("tenant_id", tenantId).eq("provider_message_id", msg.providerMessageId).eq("direction", "in").maybeSingle();
  if (seen.data) return "duplicate";

  const ins = await admin.from("whatsapp_messages").insert({
    tenant_id: tenantId, direction: "in", contact_id: contact.id, account_id: contact.account_id, kind: "inbound", origin: "provider", status: "received",
    body: encrypt(msg.text), provider_message_id: msg.providerMessageId, received_at: msg.at,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return "duplicate";
    if (isSchemaPending(ins.error)) return "ignored";
    throw ins.error;
  }
  const messageId = (ins.data as { id: string }).id;
  const keyword = classifyKeyword(msg.text);

  if (keyword === "stop") {
    await recordConsent(tenantId, {
      contactId: contact.id, channel: "whatsapp", topic: null, status: "withdrawn", basis: "consent", source: "provider_webhook",
      evidence: { message_id: messageId, keyword: "stop" },
    }, admin);
    await emitEvent(tenantId, {
      name: EVENTS.WHATSAPP_OPTED_OUT, object_type: "contact", object_id: contact.id, source: "provider_webhook", occurred_at: msg.at,
      contact_id: contact.id, account_id: contact.account_id, key: `${messageId}:opted_out`, payload: { message_id: messageId },
    }, admin);
    return "opted_out";
  }
  if (keyword === "start") {
    await recordConsent(tenantId, {
      contactId: contact.id, channel: "whatsapp", topic: null, status: "granted", basis: "consent", source: "provider_webhook",
      evidence: { message_id: messageId, keyword: "start" },
    }, admin);
    return "opted_in";
  }
  await emitEvent(tenantId, {
    name: EVENTS.WHATSAPP_REPLIED, object_type: "contact", object_id: contact.id, source: "provider_webhook", occurred_at: msg.at,
    contact_id: contact.id, account_id: contact.account_id, key: `${messageId}:replied`, payload: { message_id: messageId },
  }, admin);
  return "replied";
}
