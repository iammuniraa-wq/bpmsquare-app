// The Interactions tab of a tender (KAMCO feedback slice 11, owner answer 4): one timeline of the email exchanged with the client, and the
// rules for writing to them. PURE: no I/O and no server imports, so the route, the screen and the tests share one shape.
//
// The timeline is assembled from four places, each of which already exists:
//   - the email the tender came from            (record_sources / the Inbox message)
//   - mail the Inbox filed under this tender    (inbound_emails linked to the deal: the client's replies, and replies sent from the Inbox)
//   - what went to the client as documents      (tender_bid_sends: the priced BOQ, the answer sheet)
//   - emails written on this tab                (tender_client_messages)

import { isEmailAddress } from "../bids/rules";

export const MESSAGE_LIMITS = { toMax: 300, subjectMax: 300, bodyMax: 20_000 } as const;
/** How much of an Inbox message is drawn on the timeline; the whole message stays in the Inbox. */
export const EXCERPT_CHARS = 1_200;

export type InteractionKind = "source" | "received" | "reply" | "document" | "message";
export type InteractionDirection = "in" | "out";

export const KIND_LABEL: Record<InteractionKind, string> = {
  source: "Source email", received: "From the client", reply: "Reply from the Inbox", document: "Sent to client", message: "Email from the tender",
};

export type InteractionEntry = {
  /** Stable per source row ("msg:…", "send:…", "mail:…", "src:…"). */
  key: string;
  kind: InteractionKind;
  direction: InteractionDirection;
  at: string;
  /** Who wrote it: the client's name or address for mail that came in, the person for mail that went out. */
  who: string | null;
  to: string | null;
  subject: string | null;
  /** What was written, or a summary of it; drawn as text, never as markup. Null when the person may not read it. */
  text: string | null;
  /** The Inbox message to open, only when this person may open it (their channel). */
  inbox_id: string | null;
  redirected: boolean;
};

/** An entry as the server builds it, before the timeline merges it: `source_email_id` ties a stored source to its live Inbox row. */
export type RawEntry = InteractionEntry & { source_email_id?: string | null; mail_id?: string | null };

const t = (iso: string) => { const n = Date.parse(iso); return Number.isFinite(n) ? n : 0; };

/**
 * The timeline, newest first. The email a tender came from is stored twice (a summary on the record that outlives the email, and the
 * Inbox message while it is kept): when both exist the Inbox one wins and borrows the summary if its own text has been cleared.
 */
export function mergeTimeline(parts: readonly RawEntry[]): InteractionEntry[] {
  const liveSource = new Map<string, RawEntry>();
  for (const e of parts) if (e.mail_id) liveSource.set(e.mail_id, e);
  const kept: RawEntry[] = [];
  for (const e of parts) {
    if (e.kind === "source" && e.source_email_id && liveSource.has(e.source_email_id)) {
      const live = liveSource.get(e.source_email_id)!;
      if (!live.text && e.text) live.text = e.text;
      live.kind = "source";
      continue;
    }
    kept.push(e);
  }
  return kept
    .sort((a, b) => t(b.at) - t(a.at) || a.key.localeCompare(b.key))
    .map((e) => {
      const { source_email_id: _s, mail_id: _m, ...view } = e;
      void _s; void _m;
      return view;
    });
}

/** Addresses worth offering as "To": the people who wrote to us, then those we wrote to, most recent first, each once. */
export function suggestRecipients(entries: readonly InteractionEntry[], limit = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null) => {
    for (const piece of (raw ?? "").split(/[,;]/)) {
      const m = piece.match(/<([^>]+)>/);
      const a = (m ? m[1] : piece).trim().toLowerCase();
      if (!isEmailAddress(a) || seen.has(a)) continue;
      seen.add(a);
      out.push(a);
    }
  };
  for (const e of entries) if (e.direction === "in") add(e.who);
  for (const e of entries) if (e.direction === "out" && !e.redirected) add(e.to);
  return out.slice(0, limit);
}

/** The subject a new email starts with: a reply to the latest mail from the client, else the tender number. */
export function defaultSubject(entries: readonly InteractionEntry[], tenderNo: string | null, title: string): string {
  const last = entries.find((e) => e.direction === "in" && e.subject);
  if (last?.subject) return /^re:/i.test(last.subject.trim()) ? last.subject.trim() : `Re: ${last.subject.trim()}`;
  return (tenderNo ? `${tenderNo} · ${title}` : title).slice(0, MESSAGE_LIMITS.subjectMax);
}

export type ComposeInput = { to: string; subject: string; body: string };

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");

/** A new email to the client: one address, a subject and a message. */
export function parseCompose(raw: unknown): { ok: true; value: ComposeInput } | { ok: false; error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const to = clean(b.to);
  if (!isEmailAddress(to)) return { ok: false, error: "Enter a valid email address" };
  if (to.length > MESSAGE_LIMITS.toMax) return { ok: false, error: "The address is too long" };
  const subject = clean(b.subject).replace(/[\r\n]+/g, " ");
  if (!subject) return { ok: false, error: "Write a subject" };
  if (subject.length > MESSAGE_LIMITS.subjectMax) return { ok: false, error: `The subject is too long (${MESSAGE_LIMITS.subjectMax} characters at most)` };
  const body = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { ok: false, error: "Write the message" };
  if (body.length > MESSAGE_LIMITS.bodyMax) return { ok: false, error: `The message is too long (${MESSAGE_LIMITS.bodyMax} characters at most)` };
  return { ok: true, value: { to, subject, body } };
}

/** Where an email written here says it went: the address, or the redirect on a demo workspace. */
export function messageToText(routed: { redirected: boolean; to: readonly string[]; intended: readonly string[] }): string {
  const text = routed.redirected ? `(redirected; addressed to ${routed.intended.join(", ")})` : routed.to.join(", ");
  return text.slice(0, MESSAGE_LIMITS.toMax);
}

/** The cut of a message the timeline draws: whole words where it can, with an ellipsis when something was left out. */
export function excerpt(text: string | null | undefined, max = EXCERPT_CHARS): string | null {
  const s = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}

export type InteractionsData = {
  entries: InteractionEntry[];
  /** Addresses offered under "To". */
  suggested: string[];
  /** The subject a new email starts with. */
  subject: string;
  /** Migration 0241 has not been applied: emails cannot be written here yet. */
  messagesPending: boolean;
  /** The server can send email and the table for it exists; the page adds whether the caller may change the deal. */
  mailReady: boolean;
  /** The workspace has the Inbox (mail filed under the tender comes from there). */
  inbox: boolean;
};
