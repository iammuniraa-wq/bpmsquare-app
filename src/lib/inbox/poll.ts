import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMailbox, fetchNewMail, imapErrorText, type FetchedMail, type Mailbox } from "@/lib/mail/mailbox";
import { parseSubjectTag } from "@/lib/rfq/token";
import { INBOX_LIMITS, type InboxChannel } from "./types";
import { ingestInboxMail, type InboxMail } from "./ingest";
import { isMissingRelation, toChannel } from "./server";

// Intake B: read the client's own mailbox. For every active channel with a connected mailbox, over IMAP, read-only: a UID
// cursor per mailbox (inbox_mailbox_state, the pattern of rfq_mailbox_state), a bounded batch per run, a three-day
// look-back the first time, and nothing is ever flagged, moved or deleted on the client's server.
// Mail that carries an RFQ tag is left to the RFQ poller: the same inbox serves both.

export const POLL_FIRST_RUN_DAYS = 3;
export const POLL_MAX_MESSAGES = 25;

/** Mail that carries an RFQ tag belongs to the RFQ poller (the same mailbox serves both); everything else is a customer's. */
export const wantedForInbox = (subject: string): boolean => !parseSubjectTag(subject);

export function toInboxMail(m: FetchedMail, connectorId: string, uidValidity: bigint): InboxMail {
  return {
    provider: `imap:${connectorId}`,
    providerMessageId: m.messageId ?? `${uidValidity}:${m.uid}`,
    messageId: m.messageId, inReplyTo: m.inReplyTo, references: m.references,
    from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers, date: m.date,
    attachments: m.attachments,
  };
}

export type PollResult = { tenantId: string; channelId: string; read?: number; stored?: number; error?: string };

type State = { tenant_id: string; connector_id: string; uid_validity: string | null; last_uid: number; last_polled_at: string | null };

/** One run over every connected channel, oldest-polled first, stopping when the time budget is spent. */
export async function pollInboxMailboxes(admin: SupabaseClient, opts: {
  budgetMs?: number;
  /** Read one channel only (the "Read mail now" button); the scheduled run reads them all. */
  only?: { tenantId: string; channelId: string };
  now?: Date;
  load?: typeof loadMailbox;
  fetch?: (mb: Mailbox, state: { uidValidity: bigint | null; lastUid: number }) => ReturnType<typeof fetchNewMail>;
} = {}): Promise<{ channels: number; results: PollResult[]; pending?: boolean }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 240_000;
  const load = opts.load ?? loadMailbox;
  const fetchMail = opts.fetch ?? ((mb, state) => fetchNewMail(mb, state, {
    wanted: wantedForInbox,
    maxMessages: POLL_MAX_MESSAGES,
    maxAttachmentBytes: INBOX_LIMITS.maxAttachmentBytes,
    firstRunDays: POLL_FIRST_RUN_DAYS,
  }));

  const { data, error } = await admin.from("inbox_channels").select("*").not("connector_id", "is", null).eq("active", true);
  if (error) return { channels: 0, results: [], pending: isMissingRelation(error) };
  const withConnector = ((data ?? []) as Record<string, unknown>[]).map(toChannel).filter((c): c is InboxChannel & { connector_id: "gmail" | "mail_server" } => !!c.connector_id);
  const scoped = opts.only ? withConnector.filter((c) => c.tenant_id === opts.only!.tenantId && c.id === opts.only!.channelId) : withConnector;
  if (scoped.length === 0) return { channels: 0, results: [] };
  // A workspace without the module is not polled at all: the cursor must not move past mail nobody will read.
  const { data: on } = await admin.from("tenants").select("id").in("id", [...new Set(scoped.map((c) => c.tenant_id))]).contains("features", { inbox: true });
  const owners = new Set(((on ?? []) as { id: string }[]).map((t) => t.id));
  const channels = scoped.filter((c) => owners.has(c.tenant_id));
  if (channels.length === 0) return { channels: 0, results: [] };

  const { data: states } = await admin.from("inbox_mailbox_state").select("tenant_id, connector_id, uid_validity, last_uid, last_polled_at");
  const stateOf = new Map(((states ?? []) as State[]).map((s) => [`${s.tenant_id}:${s.connector_id}`, s]));
  channels.sort((a, b) => (stateOf.get(`${a.tenant_id}:${a.connector_id}`)?.last_polled_at ?? "").localeCompare(stateOf.get(`${b.tenant_id}:${b.connector_id}`)?.last_polled_at ?? ""));

  const results: PollResult[] = [];
  for (const ch of channels) {
    if (Date.now() - started > budget) break;
    const key = `${ch.tenant_id}:${ch.connector_id}`;
    const prev = stateOf.get(key);
    const stamp = (opts.now ?? new Date()).toISOString();
    try {
      const mb = await load(admin, ch.tenant_id, ch.connector_id);
      if (!mb) {
        results.push({ tenantId: ch.tenant_id, channelId: ch.id, error: "mailbox not connected" });
        continue;
      }
      const res = await fetchMail(mb, { uidValidity: prev?.uid_validity ? BigInt(prev.uid_validity) : null, lastUid: Number(prev?.last_uid ?? 0) });
      let stored = 0;
      for (const m of res.messages) {
        const r = await ingestInboxMail(admin, ch, toInboxMail(m, ch.connector_id, res.uidValidity), { mailboxAddress: mb.address, now: opts.now });
        if (r.ok && !r.duplicate) stored++;
      }
      await admin.from("inbox_mailbox_state").upsert({
        tenant_id: ch.tenant_id, connector_id: ch.connector_id, uid_validity: res.uidValidity.toString(), last_uid: res.lastUid, last_polled_at: stamp,
        last_error: res.skipped?.length ? `Skipped ${res.skipped.length}: ${res.skipped[0]}`.slice(0, 500) : null,
      }, { onConflict: "tenant_id,connector_id" });
      results.push({ tenantId: ch.tenant_id, channelId: ch.id, read: res.messages.length, stored });
    } catch (e) {
      const msg = imapErrorText(e) || "poll failed";
      await admin.from("inbox_mailbox_state").upsert({
        tenant_id: ch.tenant_id, connector_id: ch.connector_id, uid_validity: prev?.uid_validity ?? null, last_uid: Number(prev?.last_uid ?? 0), last_polled_at: stamp, last_error: msg,
      }, { onConflict: "tenant_id,connector_id" });
      results.push({ tenantId: ch.tenant_id, channelId: ch.id, error: msg });
    }
  }
  return { channels: channels.length, results };
}
