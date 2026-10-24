// Pure Inbox rules: no server imports and no I/O, so every one of them is unit-tested directly (rules.test.ts) and the
// screens, routes and crons share one answer. Mail content is UNTRUSTED data: nothing here ever fetches a URL from it,
// runs it, or treats a word of it as an instruction.

import { INBOX_LIMITS, RETENTION, type InboxChannel, type QualityLabel } from "./types";

// ── The forwarding address ────────────────────────────────────────────────────────────────────────────────────────
// A channel's address is `inbox-<16 random characters>@<INBOUND_EMAIL_DOMAIN>`. The random part is the capability: it
// is stored on the channel row, unique across the platform, and rotating it kills the old address. The tenant a message
// belongs to comes ONLY from the channel this key names, never from anything in the message.

const ALIAS_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no i, l, o, 0, 1
export const ALIAS_PREFIX = "inbox-";
const ALIAS_RE = /^inbox-[a-hj-km-np-z2-9]{16}$/;

/** 16 characters from 16+ random bytes (about 79 bits). The caller supplies the randomness so this stays pure. */
export function newAliasKey(random: Uint8Array): string {
  if (random.length < 16) throw new Error("newAliasKey needs at least 16 random bytes");
  let out = "";
  for (let i = 0; i < 16; i++) out += ALIAS_ALPHABET[random[i] % ALIAS_ALPHABET.length];
  return `${ALIAS_PREFIX}${out}`;
}

export const isAliasLocalPart = (s: string) => ALIAS_RE.test(s);

export function channelAddress(alias: string, domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim().toLowerCase();
  return d && isAliasLocalPart(alias) ? `${alias}@${d}` : null;
}

/** "Name <a@b.com>" or "a@b.com" to its parts; the address is lower-cased. */
export function parseAddress(raw: string | null | undefined): { name: string | null; address: string | null } {
  const s = (raw ?? "").trim();
  if (!s) return { name: null, address: null };
  const m = /^(.*?)<([^<>]+)>\s*$/.exec(s);
  const address = (m ? m[2] : s).trim().toLowerCase();
  const name = m ? m[1].trim().replace(/^["']|["']$/g, "").trim() : "";
  return { name: name || null, address: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null };
}

/** The channel alias a recipient address names for this platform domain, or null. Case-insensitive. */
export function parseAliasAddress(recipient: string, domain: string): string | null {
  const { address } = parseAddress(recipient);
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at < 0 || address.slice(at + 1) !== domain.trim().toLowerCase()) return null;
  const local = address.slice(0, at);
  return isAliasLocalPart(local) ? local : null;
}

// ── Loops and auto-replies ────────────────────────────────────────────────────────────────────────────────────────

const AUTO_SUBJECT = /^\s*(?:(?:re|fw|fwd|aw)\s*:\s*)*(?:automatic reply|auto[- ]?reply|autoreply|auto response|out of (?:the )?office|undeliverable|delivery (?:status )?notification|mail delivery (?:failed|subsystem)|returned mail|failure notice)\b/i;
const BOUNCE_SENDER = /^(?:mailer-daemon|postmaster)@/i;

export const OUR_LOOP_HEADER = "x-bpmsquare-inbox";
/** The same header as we write it on mail we send (header names are case-insensitive; this is how it reads in a mail client). */
export const OUR_LOOP_HEADER_SENT = "X-BPMSquare-Inbox";

/**
 * Why a message must not enter the Inbox, or null when it should. Auto-replies and bounces are the loop risk (our reply
 * reaches an auto-responder, which answers it, and so on), and our own mail must never be read as a customer's.
 * `own` are the addresses this channel sends from (alias, reply-from, the connected mailbox).
 */
export function skipReason(
  headers: Record<string, string> | null | undefined,
  from: string | null | undefined,
  subject: string | null | undefined,
  own: readonly (string | null | undefined)[] = [],
): string | null {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) h[k.toLowerCase()] = String(v ?? "").trim().toLowerCase();

  if (OUR_LOOP_HEADER in h) return "our own message";
  const auto = h["auto-submitted"];
  if (auto !== undefined && auto !== "no") return "auto-reply";
  if (/^(?:bulk|junk|auto_reply)$/.test(h["precedence"] ?? "")) return "auto-reply";
  if ("x-autoreply" in h || "x-autorespond" in h) return "auto-reply";
  if (h["x-auto-response-suppress"] && /\b(?:oof|autoreply|all)\b/.test(h["x-auto-response-suppress"])) return "auto-reply";
  if (h["return-path"] === "<>") return "bounce";

  const { address } = parseAddress(from);
  if (address && BOUNCE_SENDER.test(address)) return "bounce";
  if (AUTO_SUBJECT.test(subject ?? "")) return "auto-reply";
  if (address) {
    const mine = new Set(own.map((a) => parseAddress(a ?? "").address).filter((a): a is string => !!a));
    if (mine.has(address)) return "our own address";
  }
  return null;
}

// ── Text ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/** HTML mail to plain text. Scripts, styles, comments and every tag are dropped; entities are decoded once, last. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title|noscript|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|([a-z]+));/gi, (m, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Math.min(Number(dec), 0x10ffff));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return ENTITIES[String(name).toLowerCase()] ?? m;
    });
}

/** Stored text: no control characters (a NUL breaks Postgres text), tidy blank lines, capped. */
export function cleanBody(text: string, max: number = INBOX_LIMITS.maxBodyChars): string {
  const t = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}\n[message shortened]` : t;
}

/** The body to keep from a parsed mail: its plain text, else its HTML turned to text. Never HTML. */
export function bodyFrom(mail: { text?: string | null; html?: string | null }): string {
  const text = (mail.text ?? "").trim();
  return cleanBody(text ? text : mail.html ? htmlToPlain(mail.html) : "");
}

/** Where the quoted history under a reply begins. `fresh` is what the person actually wrote. */
export function splitQuoted(text: string): { fresh: string; quoted: string } {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const header = /^\s*On .{5,200}wrote:\s*$/i.test(l) || /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^\s*_{10,}\s*$/.test(l)
      || (/^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):\s/i.test(lines[i + 1] ?? ""));
    const quote = /^\s*>/.test(l) && i > 0;
    if (header || quote) {
      const fresh = lines.slice(0, i).join("\n").trim();
      if (fresh) return { fresh, quoted: lines.slice(i).join("\n").trim() };
      return { fresh: text, quoted: "" };
    }
  }
  return { fresh: text, quoted: "" };
}

/** A short plain summary of what the customer wrote: the fresh text only, whitespace collapsed, cut at a word. */
export function summarise(text: string | null | undefined, max: number = INBOX_LIMITS.summaryChars): string {
  const fresh = splitQuoted(cleanBody(text ?? "")).fresh.replace(/\s+/g, " ").trim();
  if (fresh.length <= max) return fresh;
  const cut = fresh.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

export const snippetOf = (text: string | null | undefined) => summarise(text, INBOX_LIMITS.snippetChars);

/** A suggested name for a new account or lead: the display name, else the part of the address before the @. */
export function suggestedName(from: { name: string | null; address: string | null }): string {
  if (from.name) return from.name.slice(0, 120);
  const local = (from.address ?? "").split("@")[0] ?? "";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 120) || "New customer";
}

/** The email as the pasted brief the estimator's intake reads: subject, sender, and what they wrote (no quoted history). */
export function emailAsBrief(email: { subject: string; from_name: string | null; from_address: string | null; body_text: string | null }, max = 19_000): string {
  const fresh = summarise(email.body_text ?? "", max);
  const sender = [email.from_name, email.from_address ? `<${email.from_address}>` : ""].filter(Boolean).join(" ");
  return `Subject: ${email.subject}\nFrom: ${sender}\n\n${fresh}`.slice(0, max);
}

// ── Threads and replies ───────────────────────────────────────────────────────────────────────────────────────────

/** "<ABC@x>" and "abc@x" are the same message. */
export function normaliseMessageId(id: string | null | undefined): string | null {
  const s = (id ?? "").trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return s ? s.slice(0, 250) : null;
}

export function messageIdList(refs: string | null | undefined): string[] {
  return (refs ?? "").match(/<[^<>\s]+>/g)?.map((x) => normaliseMessageId(x)).filter((x): x is string => !!x) ?? [];
}

export function normaliseSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^\s*(?:re|fw|fwd|aw|sv|wg)\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

/** "Re: subject", never "Re: Re:". */
export const replySubject = (subject: string | null | undefined) => {
  const base = normaliseSubject(subject);
  return `Re: ${base || "Your enquiry"}`.slice(0, INBOX_LIMITS.maxSubjectChars);
};

/**
 * The thread a message belongs to: the thread of the message it answers when that is known, else the root of its
 * References, else its In-Reply-To, else its own id, else the subject and sender. Mail with none of these still threads
 * with a follow-up that repeats the subject.
 */
export function threadKeyFor(
  mail: { messageId?: string | null; inReplyTo?: string | null; references?: string | null; subject?: string | null; from?: string | null },
  parentThreadKey?: string | null,
): string {
  if (parentThreadKey) return parentThreadKey;
  const refs = messageIdList(mail.references);
  if (refs[0]) return `m:${refs[0]}`;
  const reply = normaliseMessageId(mail.inReplyTo);
  if (reply) return `m:${reply}`;
  const own = normaliseMessageId(mail.messageId);
  if (own) return `m:${own}`;
  return `s:${normaliseSubject(mail.subject).toLowerCase()}|${parseAddress(mail.from).address ?? ""}`.slice(0, 300);
}

/** In-Reply-To and References for our reply to `original`, so the customer's client files it in the same conversation. */
export function replyHeaders(original: { message_id: string | null; references?: string | null }): { inReplyTo: string | undefined; references: string | undefined } {
  const id = normaliseMessageId(original.message_id);
  if (!id) return { inReplyTo: undefined, references: undefined };
  const earlier = messageIdList(original.references).filter((r) => r !== id);
  const refs = [...earlier, id].slice(-10).map((r) => `<${r}>`);
  return { inReplyTo: `<${id}>`, references: refs.join(" ") };
}

/** One message-id for a message we send: unique, in a domain we control, never reused. */
export const outgoingMessageId = (unique: string, domain: string) => `<inbox.${unique}@${domain}>`;

export function askForDrawingReply(opts: { customerName?: string | null; companyName: string }): string {
  const hello = opts.customerName ? `Hello ${opts.customerName.split(/\s+/)[0]},` : "Hello,";
  return [
    hello,
    "",
    "Thank you for your enquiry. To price it accurately we need a drawing we can read. Could you please send it as a PDF or a DXF file?",
    "",
    "If you only have a DWG, open it in your CAD program and use Save As to save a DXF. Word and Excel files also work. Photos and scanned sketches are hard to measure, so please send one of these formats if you can.",
    "",
    "Kind regards,",
    opts.companyName,
  ].join("\n");
}

// ── Attachments ───────────────────────────────────────────────────────────────────────────────────────────────────

export const ATTACHMENT_EXTS = ["pdf", "dxf", "dwg", "docx", "xlsx", "csv", "png", "jpg", "txt"] as const;
export type AttachmentExt = (typeof ATTACHMENT_EXTS)[number];

export const ATTACHMENT_MIME: Record<AttachmentExt, string> = {
  pdf: "application/pdf",
  dxf: "image/vnd.dxf",
  dwg: "image/vnd.dwg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  txt: "text/plain",
};

export const extOfName = (filename: string): string => (/\.([a-z0-9]{1,6})$/i.exec(filename.trim())?.[1] ?? "").toLowerCase();

/** A file name that is safe to store and to put in a Content-Disposition header. */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/\r\n"<>|:*?\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 150);
  const out = base && base !== "." && base !== ".." ? base : `file.${ext}`;
  return extOfName(out) === ext || (ext === "jpg" && extOfName(out) === "jpeg") ? out : `${out}.${ext}`;
}

const asciiAt = (b: Uint8Array, at: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};
const hasAscii = (b: Uint8Array, needle: string): boolean => {
  const n = needle.length;
  outer: for (let i = 0; i + n <= b.length; i++) {
    for (let j = 0; j < n; j++) if (b[i + j] !== needle.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
};

export type Sniffed = { ok: true; ext: AttachmentExt; mime: string } | { ok: false; reason: string };

/**
 * What a file REALLY is, read from its first bytes, never from its name or the type the sender claimed. Only the
 * allow-list gets through: pdf, dxf, dwg, docx, xlsx, csv, png, jpg, txt. A zip that is not Word or Excel, a page
 * that merely renamed itself .txt, an executable called .pdf: all refused. The stored extension and MIME type come
 * from here, so a file can never be served as something other than what it is.
 */
export function sniffAttachment(buf: Uint8Array, filename: string): Sniffed {
  if (buf.length === 0) return { ok: false, reason: "empty" };
  const head = buf.subarray(0, 8192);
  const nameExt = extOfName(filename);
  const done = (ext: AttachmentExt): Sniffed => ({ ok: true, ext, mime: ATTACHMENT_MIME[ext] });

  if (head.length >= 5 && (asciiAt(head, 0, "%PDF-") || hasAscii(head.subarray(0, 1024), "%PDF-"))) return done("pdf");
  if (head.length >= 8 && head[0] === 0x89 && asciiAt(head, 1, "PNG\r\n") && head[6] === 0x1a && head[7] === 0x0a) return done("png");
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return done("jpg");
  if (head.length >= 6 && asciiAt(head, 0, "AC10") && head[4] >= 0x30 && head[4] <= 0x39 && head[5] >= 0x30 && head[5] <= 0x39) return done("dwg");
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    // A zip container: only the two Office formats, told apart by the folder they must contain.
    if (hasAscii(buf, "word/document.xml")) return done("docx");
    if (hasAscii(buf, "xl/workbook.xml")) return done("xlsx");
    return { ok: false, reason: "archive" };
  }
  if (asciiAt(head, 0, "AutoCAD Binary DXF")) return done("dxf");

  // Text formats: no binary bytes at all, and nothing that looks like a web page or script.
  if (head.includes(0)) return { ok: false, reason: "unknown binary" };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  if (/�/.test(text) && (text.match(/�/g)?.length ?? 0) > 4) return { ok: false, reason: "unknown binary" };
  if (/<\s*(?:!doctype|html|svg|script|iframe|\?xml)/i.test(text.slice(0, 2048))) return { ok: false, reason: "markup" };
  if (/^\s*0\s*\r?\n\s*SECTION\s*\r?\n/.test(text)) return done("dxf");
  if (nameExt === "csv") return done("csv");
  if (nameExt === "txt") return done("txt");
  return { ok: false, reason: "unknown type" };
}

/**
 * Good, Needs review or Poor, from the type and the size alone (owner decision 2026-10-24): vector drawings and
 * documents read well; photos and scans are a last resort read as far as possible and always reviewed; a DWG cannot be
 * read here at all. The note says what to do next.
 */
export function attachmentQuality(ext: string, sizeBytes: number): { quality: QualityLabel; note: string | null } {
  switch (ext) {
    case "dxf":
      return { quality: "good", note: null };
    case "docx": case "xlsx": case "csv": case "txt":
      return { quality: "good", note: null };
    case "pdf":
      return sizeBytes < 15_000
        ? { quality: "review", note: "Very small PDF. It may be blank or only a cover page." }
        : { quality: "good", note: null };
    case "png": case "jpg":
      return sizeBytes < 100_000
        ? { quality: "poor", note: "Small photo or scan. Ask for a PDF or DXF." }
        : { quality: "review", note: "A photo or scan can only be read as far as it is clear. Ask for a PDF or DXF if details are missing." };
    case "dwg":
      return { quality: "poor", note: "A DWG cannot be read here. Ask the customer to save a DXF or PDF." };
    default:
      return { quality: "review", note: null };
  }
}

/** The mail needs a better drawing: it carries files, and none of them is good. */
export function needsBetterDrawing(files: readonly { quality: QualityLabel }[]): boolean {
  return files.length > 0 && !files.some((f) => f.quality === "good");
}

// ── Retention ─────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** A mail nobody converts is purged 90 days after it arrived. */
export const expiryOnReceipt = (receivedAt: Date) => addDays(receivedAt, RETENTION.neverConvertedDays);
/** Once converted, the body is kept 30 days from the conversion, then discarded. */
export const expiryOnConversion = (convertedAt: Date) => addDays(convertedAt, RETENTION.convertedDays);

export const isExpired = (row: { expires_at: string; purged_at: string | null }, now: Date = new Date()) =>
  !row.purged_at && Date.parse(row.expires_at) <= now.getTime();

// ── Who sees a channel ────────────────────────────────────────────────────────────────────────────────────────────

export type Viewer = { isAdmin: boolean; roleIds: readonly string[] };

/**
 * A channel with no team is open to everyone who can open the Inbox. A channel with a team is for people holding one of
 * its Business Roles, and for admins. A member with no role at all is "unrestricted" elsewhere in the product, but a
 * team channel exists precisely to narrow who reads it, so they are not let in.
 */
export function canSeeChannel(channel: Pick<InboxChannel, "role_ids" | "active">, viewer: Viewer): boolean {
  if (viewer.isAdmin) return true;
  if (!channel.role_ids || channel.role_ids.length === 0) return true;
  return channel.role_ids.some((r) => viewer.roleIds.includes(r));
}

export const visibleChannels = <T extends Pick<InboxChannel, "role_ids" | "active">>(channels: readonly T[], viewer: Viewer): T[] =>
  channels.filter((c) => canSeeChannel(c, viewer));

// ── Numbers ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Median minutes from a thread's first customer message to our first reply after it; null when nobody has replied. */
export function medianFirstReplyMinutes(rows: readonly { thread_key: string | null; direction: "in" | "out"; received_at: string }[]): number | null {
  const byThread = new Map<string, { in: number[]; out: number[] }>();
  for (const r of rows) {
    if (!r.thread_key) continue;
    const t = Date.parse(r.received_at);
    if (!Number.isFinite(t)) continue;
    const e = byThread.get(r.thread_key) ?? { in: [], out: [] };
    e[r.direction].push(t);
    byThread.set(r.thread_key, e);
  }
  const gaps: number[] = [];
  for (const e of byThread.values()) {
    if (e.in.length === 0 || e.out.length === 0) continue;
    const first = Math.min(...e.in);
    const reply = e.out.filter((o) => o >= first).sort((a, b) => a - b)[0];
    if (reply !== undefined) gaps.push((reply - first) / 60_000);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const med = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(med);
}

/** "3 min", "2 h 10 min", "1 d 4 h". */
export function minutesWord(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "–";
  if (min < 1) return "under 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(min / 1440), h = Math.round((min % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Fits the "Re:" / default-template choices to what the owner's list shows first. */
export function orderCreateTypes<T extends string>(all: readonly T[], preferred: string | null | undefined): T[] {
  return preferred && (all as readonly string[]).includes(preferred) ? [preferred as T, ...all.filter((t) => t !== preferred)] : [...all];
}
