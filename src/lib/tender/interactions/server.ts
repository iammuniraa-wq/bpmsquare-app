import "server-only";
import { getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { decrypt, encrypt } from "@/lib/encryption";
import { loadActorNames } from "@/lib/actorNames";
import { logChange } from "@/lib/changeLog";
import { EMAIL_COLUMNS, hiddenEmailIds, isMissingRelation, toEmail } from "@/lib/inbox/server";
import { isMissingSchema } from "../server";
import type { TenderDealRequest } from "../dealAccess";
import { SEND_CHANNEL_LABEL, SEND_DOCUMENT_LABEL } from "../bids/rules";
import { listSends } from "../bids/sends";
import { defaultMailer, loadNotifyTenant, sendTenderMailDetailed } from "../notify";
import { defaultSubject, excerpt, mergeTimeline, messageToText, suggestRecipients, type ComposeInput, type InteractionsData, type RawEntry } from "./rules";

// Server side of the Interactions tab (migration 0241, KAMCO feedback slice 11). Every query is tenant-scoped on the admin client and
// every source tolerates its table being missing (the tab then shows what it can). Mail is private correspondence: an Inbox message is
// drawn with its text only to a person who may open its channel; everyone who may open the tender sees who wrote, when and the subject,
// exactly as the "From email" block of any record does.

export const PENDING_MESSAGES = "Sending from here needs a database update (migration 0241). Ask your administrator to apply it.";

type MessageRow = { id: string; sent_at: string; sent_by: string | null; to_text: string; subject: string; body: string | null; redirected: boolean | null };
type SourceRow = { source_email_id: string | null; from_address: string | null; from_name: string | null; subject: string | null; summary: string | null; received_at: string | null; created_at: string };

const personOf = (name: string | null, address: string | null) => (name && address ? `${name} <${address}>` : name ?? address ?? null);
const safeDecrypt = (v: string | null) => { try { return decrypt(v); } catch { return null; } };

export async function loadInteractions(req: TenderDealRequest): Promise<InteractionsData> {
  const { admin, supabase, tenantId, userId, role, opp, tender } = req;
  const parts: RawEntry[] = [];
  const inboxOn = await tenantHasFeature(supabase, tenantId, "inbox");

  // Emails written on this tab.
  let messagesPending = false;
  const msg = await admin.from("tender_client_messages").select("id, sent_at, sent_by, to_text, subject, body, redirected").eq("tenant_id", tenantId).eq("opportunity_id", opp.id).order("sent_at", { ascending: false }).limit(200);
  if (msg.error) messagesPending = isMissingSchema(msg.error);
  const messages = msg.error ? [] : ((msg.data ?? []) as MessageRow[]);

  // What went to the client as documents.
  const sends = await listSends(admin, tenantId, opp.id);

  // The Inbox: the email the tender came from, and the mail it filed under the tender.
  let sources: SourceRow[] = [];
  let mails: Record<string, unknown>[] = [];
  if (inboxOn) {
    const [src, mail] = await Promise.all([
      admin.from("record_sources").select("source_email_id, from_address, from_name, subject, summary, received_at, created_at").eq("tenant_id", tenantId).eq("object_type", "opportunities").eq("object_id", opp.id).limit(20),
      admin.from("inbound_emails").select(EMAIL_COLUMNS).eq("tenant_id", tenantId).eq("linked_object_type", "opportunities").eq("linked_object_id", opp.id).order("received_at", { ascending: false }).limit(200),
    ]);
    if (src.error) { if (!isMissingRelation(src.error)) console.error("[tender] interactions sources", src.error.message); } else sources = (src.data ?? []) as SourceRow[];
    if (mail.error) { if (!isMissingRelation(mail.error)) console.error("[tender] interactions mail", mail.error.message); } else mails = (mail.data ?? []) as Record<string, unknown>[];
  }

  const names = await loadActorNames(admin, tenantId, [...messages.map((m) => m.sent_by), ...mails.map((m) => (m.created_by as string | null) ?? null)]);
  const hidden = mails.length ? await hiddenEmailIds(admin, tenantId, userId, role === "admin", mails.map((m) => m.id as string)) : new Set<string>();

  for (const m of messages) {
    parts.push({
      key: `msg:${m.id}`, kind: "message", direction: "out", at: m.sent_at, who: m.sent_by ? names.get(m.sent_by) ?? null : null, to: m.to_text, subject: m.subject,
      text: excerpt(safeDecrypt(m.body)), inbox_id: null, redirected: m.redirected === true,
    });
  }
  for (const s of sends.rows) {
    parts.push({
      key: `send:${s.id}`, kind: "document", direction: "out", at: s.sent_at, who: s.sent_by_name, to: s.to_text,
      subject: `${SEND_DOCUMENT_LABEL[s.document]} · ${SEND_CHANNEL_LABEL[s.channel].toLowerCase()}`,
      text: [s.version_no ? `Bid version ${s.version_no}` : null, s.note].filter(Boolean).join(" · ") || null, inbox_id: null, redirected: (s.to_text ?? "").startsWith("(redirected"),
    });
  }
  for (const raw of mails) {
    const e = toEmail(raw, true);
    const canOpen = !hidden.has(e.id);
    const incoming = e.direction === "in";
    parts.push({
      key: `mail:${e.id}`, kind: incoming ? "received" : "reply", direction: e.direction, at: e.received_at,
      who: incoming ? personOf(e.from_name, e.from_address) : (e.created_by ? names.get(e.created_by) ?? null : null),
      to: e.to_addresses.length ? e.to_addresses.join(", ") : null, subject: e.subject || null,
      text: canOpen ? excerpt(e.body_text ?? e.snippet) : null, inbox_id: canOpen ? e.id : null, redirected: e.send_status === "redirected", mail_id: e.id,
    });
  }
  for (const r of sources) {
    parts.push({
      key: `src:${r.source_email_id ?? r.created_at}`, kind: "source", direction: "in", at: r.received_at ?? r.created_at, who: personOf(r.from_name, r.from_address),
      to: null, subject: r.subject, text: excerpt(safeDecrypt(r.summary)), inbox_id: null, redirected: false, source_email_id: r.source_email_id,
    });
  }

  const entries = mergeTimeline(parts);
  return {
    entries, suggested: suggestRecipients(entries), subject: defaultSubject(entries, tender.tender_no ?? null, opp.title),
    messagesPending, mailReady: !!defaultMailer() && !messagesPending, inbox: inboxOn,
  };
}

/** Sends one email to the client through the tender (resolveOutbound inside), keeps it on the timeline and writes the change log. */
export async function sendClientMessage(req: TenderDealRequest, input: ComposeInput): Promise<{ ok: true; redirected: boolean; intended: string[] } | { ok: false; status: number; error: string }> {
  const { admin, supabase, tenantId, userId, opp } = req;
  const mailer = defaultMailer();
  if (!mailer) return { ok: false, status: 503, error: "Email is not set up on this server" };
  // The table is checked BEFORE anything is sent, so a message that went is never left off the timeline.
  const ready = await admin.from("tender_client_messages").select("id").eq("tenant_id", tenantId).eq("opportunity_id", opp.id).limit(1);
  if (ready.error) return isMissingSchema(ready.error) ? { ok: false, status: 503, error: PENDING_MESSAGES } : { ok: false, status: 500, error: ready.error.message };
  const tenant = await loadNotifyTenant(admin, tenantId);
  if (!tenant) return { ok: false, status: 404, error: "Not found" };

  const user = await getAuthUser();
  const result = await sendTenderMailDetailed(admin, tenant, {
    to: [input.to], subject: input.subject, text: input.body, dealId: opp.id, dealLabel: `${opp.ref ?? ""} ${opp.title}`.trim(),
    actorId: user?.id ?? userId, actorEmail: user?.email,
  }, mailer);
  if (!result.ok) return { ok: false, status: result.stage === "route" ? 409 : 502, error: result.error };

  const toText = messageToText(result);
  const { error } = await admin.from("tender_client_messages").insert({
    tenant_id: tenantId, opportunity_id: opp.id, sent_by: userId, to_text: toText, subject: input.subject, body: encrypt(input.body), redirected: result.redirected,
  });
  if (error) return { ok: false, status: 500, error: `The email went, but it could not be kept on the timeline: ${error.message}` };

  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email,
    changes: [{ field: "Email to client", from: null, to: `${input.subject} · ${toText}`.slice(0, 300) }],
  });
  return { ok: true, redirected: result.redirected, intended: result.intended };
}
