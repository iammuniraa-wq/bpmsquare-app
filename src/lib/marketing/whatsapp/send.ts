import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { decrypt, encrypt } from "@/lib/encryption";
import { EVENTS } from "@/lib/events/catalog";
import type { EventSource } from "@/lib/events/catalog";
import { emitEvent } from "@/lib/events/emit";
import { canContact, type ContactDecision } from "@/lib/marketing/consent";
import { isSchemaPending } from "@/lib/marketing/pending";
import { loadIdentity, providerIdentity, whatsappEnabled } from "./identity";
import { normalisePhone, phoneBlindIndex } from "./phone";
import { getProvider, type WhatsAppProvider } from "./provider";
import { capCheck, sendRule, weeklyCapOf, whatsappOutputFor } from "./rules";
import { renderTemplate, type TemplateStatus, type Values } from "./template";

// The ONE way a WhatsApp message leaves the product (docs/shells/whatsapp-shell.md). A person on a record and
// a journey step both come through here, so the rules cannot be bypassed by either:
//
//   1. the workspace must own the module;
//   2. canContact(whatsapp, topic) -- consent is a hard gate and is asked BEFORE anything else is looked at,
//      so a refusal is never hidden behind a setup problem, and it is asked now, not when someone enrolled;
//   3. the template must be approved (a free-form message needs an open 24-hour window and a person: see
//      rules.ts sendRule; a journey cannot send one);
//   4. the weekly cap, for marketing templates;
//   5. a demo workspace never reaches a real number (rules.ts whatsappOutputFor);
//   6. the message row is written BEFORE the provider is called, and a repeated client_ref finds that row, so
//      a retried tick cannot send twice;
//   7. whatsapp.sent / whatsapp.failed go to the event stream.
//
// Tenant isolation: this runs on the service-role client, so every query names the tenant, and the contact and
// template are loaded by id AND tenant before they are used.

export type SendArgs = {
  tenantId: string;
  contactId: string;
  templateId: string;
  origin: "rep" | "journey";
  actorId?: string | null;
  journeyId?: string | null;
  /** Makes the send idempotent: the same ref never sends twice. A journey step passes "<run>:<step>". */
  clientRef?: string | null;
  values?: Values;
  /** Loop guard for the events this send emits. */
  depth?: number;
};

export type SendOutcome = {
  status: "sent" | "dry_run" | "skipped" | "failed";
  reason: string;
  detail?: string;
  messageId: string | null;
  /** For a skip that is only "not yet" (the weekly cap): when it would be allowed. */
  retryAt?: Date;
};

export type SendDeps = {
  now?: () => Date;
  gate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  provider?: WhatsAppProvider;
};

type TemplateRow = { id: string; name: string; language: string; category: string; body: string; provider_template_name: string | null; status: TemplateStatus; topic: string | null };
type ContactRow = { id: string; account_id: string; phone: string | null; country: string | null };

const skip = (reason: string, detail?: string, retryAt?: Date): SendOutcome => ({ status: "skipped", reason, detail, messageId: null, retryAt });

export async function sendWhatsAppTemplate(admin: SupabaseClient, a: SendArgs, deps: SendDeps = {}): Promise<SendOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const tenantId = a.tenantId;
  try {
    // 1. the workspace
    const { data: tenant, error: tErr } = await admin.from("tenants").select("name, is_demo, config, features").eq("id", tenantId).maybeSingle();
    if (tErr || !tenant) return skip("module_off");
    const t = tenant as { name: string; is_demo: boolean | null; config: TenantConfig | null; features: Partial<TenantFeatures> | null };
    if (!whatsappEnabled(t.features)) return skip("module_off");

    // The template is read first only to learn the topic consent is checked against; nothing is decided from it yet.
    const { data: tpl, error: pErr } = await admin.from("whatsapp_templates")
      .select("id, name, language, category, body, provider_template_name, status, topic").eq("id", a.templateId).eq("tenant_id", tenantId).maybeSingle();
    if (pErr) return isSchemaPending(pErr) ? skip("module_off") : { status: "failed", reason: "send_failed", detail: pErr.message.slice(0, 200), messageId: null };
    if (!tpl) return skip("template_missing");
    const template = tpl as TemplateRow;

    // 2. consent, first
    const gate = deps.gate ?? ((tid: string, cid: string, topic: string | null) => canContact(tid, cid, "whatsapp", topic, admin));
    const consent = await gate(tenantId, a.contactId, template.topic);
    if (!consent.ok) return skip(consent.reason, consent.detail);

    // 3. the template
    const rule = sendRule({ kind: "template", actor: a.origin, lastInboundAt: null, templateStatus: template.status, now });
    if (!rule.ok) return skip(rule.reason);

    // identity and the person
    const { row: identity, missing: idMissing } = await loadIdentity(admin, tenantId);
    if (idMissing) return skip("module_off");
    if (!identity || identity.status !== "active") return skip("no_identity");
    const provider = deps.provider ?? getProvider(identity.provider);
    if (!provider) return skip("no_identity", "The provider for this workspace is not available.");

    const { data: c } = await admin.from("contacts").select("id, account_id, phone, country").eq("id", a.contactId).eq("tenant_id", tenantId).maybeSingle();
    if (!c) return skip("contact_not_found");
    const contact = c as ContactRow;
    let country = contact.country;
    if (!country) {
      const { data: acct } = await admin.from("accounts").select("country").eq("id", contact.account_id).eq("tenant_id", tenantId).maybeSingle();
      country = (acct as { country?: string | null } | null)?.country ?? null;
    }
    const phone = normalisePhone(decrypt(contact.phone), country);
    if (!phone) return skip("no_phone");

    // 4. the weekly cap (marketing templates only)
    if (template.category === "marketing") {
      const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const { data: recent } = await admin.from("whatsapp_messages").select("created_at, status, category, direction")
        .eq("tenant_id", tenantId).eq("contact_id", contact.id).eq("direction", "out").eq("category", "marketing").gte("created_at", since);
      const times = ((recent ?? []) as { created_at: string; status: string }[]).filter((r) => r.status !== "failed").map((r) => new Date(r.created_at));
      const cap = capCheck(times, now, weeklyCapOf(t.config));
      if (!cap.ok) return skip("weekly_cap", undefined, cap.resumeAt);
    }

    // 5. where it really goes
    const output = whatsappOutputFor({ isDemo: t.is_demo === true, config: t.config });
    const dryRun = output.mode === "dry_run" || !provider.live;
    const to = output.mode === "redirect" ? output.to : phone;

    // 6. the row first
    const rendered = renderTemplate(template.body, { company_name: t.name, ...a.values });
    const base = {
      tenant_id: tenantId, direction: "out", contact_id: contact.id, account_id: contact.account_id, template_id: template.id,
      journey_id: a.journeyId ?? null, kind: "template", origin: a.origin, status: "queued", category: template.category, lang: template.language,
      body: encrypt(rendered.text), to_phone: encrypt(phone), redirected_to: output.mode === "redirect" ? encrypt(output.to) : null,
      provider: provider.id, client_ref: a.clientRef ?? null, created_by: a.actorId ?? null,
    };
    let messageId: string | null = null;
    if (a.clientRef) {
      const { data: prior } = await admin.from("whatsapp_messages").select("id, status").eq("tenant_id", tenantId).eq("client_ref", a.clientRef).maybeSingle();
      const p = prior as { id: string; status: string } | null;
      if (p && p.status !== "failed") return { status: p.status === "dry_run" ? "dry_run" : "sent", reason: "already_sent", messageId: p.id };
      if (p) {
        messageId = p.id;
        await admin.from("whatsapp_messages").update({ status: "queued", error: null }).eq("id", p.id).eq("tenant_id", tenantId);
      }
    }
    if (!messageId) {
      const ins = await admin.from("whatsapp_messages").insert(base).select("id").single();
      if (ins.error || !ins.data) {
        if (ins.error?.code === "23505" && a.clientRef) {
          const { data: again } = await admin.from("whatsapp_messages").select("id, status").eq("tenant_id", tenantId).eq("client_ref", a.clientRef).maybeSingle();
          const g = again as { id: string; status: string } | null;
          if (g) return { status: g.status === "dry_run" ? "dry_run" : "sent", reason: "already_sent", messageId: g.id };
        }
        if (ins.error && isSchemaPending(ins.error)) return skip("module_off");
        return { status: "failed", reason: "send_failed", detail: ins.error?.message?.slice(0, 200), messageId: null };
      }
      messageId = (ins.data as { id: string }).id;
    }

    // the provider (or the dry run)
    let status: "sent" | "dry_run" | "failed" = "dry_run";
    let providerMessageId: string | null = null;
    let error: string | null = null;
    if (!dryRun) {
      const r = await provider.sendTemplate(providerIdentity(identity), {
        to, templateName: template.provider_template_name ?? template.name, language: template.language, params: rendered.params, clientRef: messageId,
      });
      if (r.ok) { status = "sent"; providerMessageId = r.providerMessageId; } else { status = "failed"; error = r.error.slice(0, 300); }
    }
    await admin.from("whatsapp_messages")
      .update({ status, provider_message_id: providerMessageId, error, sent_at: status === "failed" ? null : now.toISOString() })
      .eq("id", messageId).eq("tenant_id", tenantId);

    // 7. the event stream (ids and short codes, never the text or the number)
    await emitEvent(tenantId, {
      name: status === "failed" ? EVENTS.WHATSAPP_FAILED : EVENTS.WHATSAPP_SENT, object_type: "whatsapp_template", object_id: template.id,
      actor_id: a.actorId ?? null, source: (a.origin === "journey" ? "runner" : "app") as EventSource, depth: a.depth ?? (a.origin === "journey" ? 1 : 0),
      contact_id: contact.id, account_id: contact.account_id, lang: template.language, topic: template.topic,
      key: `${messageId}:${status === "failed" ? "failed" : "sent"}`,
      payload: { message_id: messageId, template_id: template.id, category: template.category, dry_run: status === "dry_run" },
    }, admin);

    // So an inbound reply from this number can be matched to this person.
    try {
      await admin.from("whatsapp_numbers").upsert({ tenant_id: tenantId, contact_id: contact.id, phone_hash: phoneBlindIndex(phone) }, { onConflict: "tenant_id,contact_id,phone_hash", ignoreDuplicates: true });
    } catch (e) {
      console.error("[whatsapp] number not indexed", e);
    }

    if (status === "failed") return { status: "failed", reason: "send_failed", detail: error ?? undefined, messageId };
    return { status, reason: status === "dry_run" ? "dry_run" : "sent", messageId };
  } catch (e) {
    console.error("[whatsapp] send failed", e);
    return { status: "failed", reason: "send_failed", detail: (e as { message?: string })?.message?.slice(0, 200), messageId: null };
  }
}
