// GCC tender deals, slice 2: the internal Deal Room (docs/design/gcc-tender-deals.md section 4 as changed by section 10).
// Pure rules, no I/O and no server imports, so the routes, the digest job, the screen and the tests share one reading of
// "what is a valid message", "who was mentioned", "what is unread", "when may a digest go" and "when do we poll next".
//
// INTERNAL ONLY. Nothing here knows about guests, codes or links; `channel` only ever holds 'team'.

export const ROOM = {
  /** Poll while the tab is visible; back off when hidden or after failures. */
  pollMs: 10_000,
  hiddenPollMs: 60_000,
  maxPollMs: 120_000,
  /** A poll asks for "changed since cursor minus this", and the client de-duplicates by id: a row committed a moment late is still found. */
  overlapMs: 2_000,
  bodyMax: 4_000,
  decisionMax: 200,
  pageSize: 100,
  maxFiles: 5,
  maxFileBytes: 15 * 1024 * 1024,
  /** At most one digest e-mail per member per 15 minutes; the slack covers a scheduler that fires a few seconds early. */
  digestGapMs: 15 * 60_000,
  digestSlackMs: 60_000,
  digestRooms: 5,
  digestLines: 3,
  snippetChars: 120,
  /** The server writes last_seen_at at most this often per member. */
  seenThrottleMs: 60_000,
} as const;

export const ROOM_CHANNEL = "team" as const;
export const ROOM_KINDS = ["message", "question", "decision"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export type QuestionStatus = "open" | "answered";

// ── Reading a posted message ───────────────────────────────────────────────────────────────────────────────────────

export type ParsedMessage =
  | { ok: true; kind: RoomKind; text: string; parentId: string | null; ownerId: string | null; due: string | null }
  | { ok: false; error: string };

/** Control characters out (a message is text, nothing else); newlines and tabs stay. */
export function cleanText(v: string): string {
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a request may post. Only these fields are read: the author, the room, the channel, the mentions and every timestamp
 * come from the session and the server, never from the body. A decision is one line and cannot be a reply or a question.
 */
export function parseMessage(body: Record<string, unknown>): ParsedMessage {
  const asQuestion = body.kind === "question" || body.is_question === true;
  const kind: RoomKind = body.kind === "decision" ? "decision" : asQuestion ? "question" : "message";
  if (body.kind !== undefined && body.kind !== "message" && body.kind !== "question" && body.kind !== "decision") return { ok: false, error: "kind must be message, question or decision" };
  if (typeof body.body !== "string") return { ok: false, error: "Write something first" };
  let text = cleanText(body.body);
  if (kind === "decision") text = text.replace(/\s+/g, " ");
  if (!text) return { ok: false, error: kind === "decision" ? "Write the decision first" : "Write something first" };
  const max = kind === "decision" ? ROOM.decisionMax : ROOM.bodyMax;
  if (text.length > max) return { ok: false, error: kind === "decision" ? `A decision is one line of up to ${max} characters` : `A message is up to ${max} characters` };

  const parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id.slice(0, 64) : null;
  if (kind === "decision" && parentId) return { ok: false, error: "A decision cannot be a reply" };

  let ownerId: string | null = null;
  let due: string | null = null;
  if (kind === "question") {
    ownerId = typeof body.owner_id === "string" && body.owner_id ? body.owner_id.slice(0, 64) : null;
    if (body.due !== undefined && body.due !== null && body.due !== "") {
      if (typeof body.due !== "string" || !DATE_RE.test(body.due) || Number.isNaN(Date.parse(body.due))) return { ok: false, error: "The due date must be YYYY-MM-DD" };
      due = body.due;
    }
  }
  return { ok: true, kind, text, parentId, ownerId, due };
}

/** Is `due` earlier than today (workspace date key)? An answered question is never overdue. */
export function questionState(q: { question_status: QuestionStatus | null; question_due: string | null }, todayKey: string): "answered" | "overdue" | "open" {
  if (q.question_status === "answered") return "answered";
  return q.question_due && q.question_due < todayKey ? "overdue" : "open";
}

// ── Mentions ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoomPerson = { user_id: string; name: string | null; email: string | null };

/**
 * What a person is called in a mention: their name, or their e-mail when the name is missing or shared with someone else in
 * the room (so "@Name" is never ambiguous). The composer inserts exactly this label.
 */
export function mentionLabels(people: readonly RoomPerson[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const p of people) {
    const n = p.name?.trim().toLowerCase();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const p of people) {
    const n = p.name?.trim();
    const label = n && counts.get(n.toLowerCase()) === 1 ? n : p.email?.trim() || n || p.user_id.slice(0, 8);
    out.set(p.user_id, label);
  }
  return out;
}

const WORD = /[A-Za-z0-9_]/;

/**
 * Who a message mentions: every room member whose "@label" appears in the text. The list is READ FROM THE TEXT, so nobody
 * can be notified who is not named in what everyone reads. Longest label first, and the matched text is used up, so "@Anna"
 * never also matches "@Ann". `authorId` is never mentioned by their own message.
 */
export function mentionedUserIds(text: string, people: readonly RoomPerson[], authorId: string | null = null): string[] {
  const labels = mentionLabels(people);
  const order = [...people].sort((a, b) => (labels.get(b.user_id) ?? "").length - (labels.get(a.user_id) ?? "").length);
  let hay = text.toLowerCase();
  const hit: string[] = [];
  for (const p of order) {
    const needle = `@${(labels.get(p.user_id) ?? "").toLowerCase()}`;
    if (needle.length < 2) continue;
    let from = 0;
    let found = false;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const before = at === 0 ? "" : hay[at - 1];
      const after = hay[at + needle.length] ?? "";
      from = at + needle.length;
      if ((before && WORD.test(before)) || (after && WORD.test(after))) continue;
      hay = `${hay.slice(0, at)}${" ".repeat(needle.length)}${hay.slice(at + needle.length)}`;
      found = true;
    }
    if (found && p.user_id !== authorId) hit.push(p.user_id);
  }
  return hit;
}

// ── Links in plain text ────────────────────────────────────────────────────────────────────────────────────────────

export type Segment = { type: "text"; value: string } | { type: "link"; href: string; label: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAIL = /[.,;:!?)\]}]+$/;

/**
 * A message as segments the screen draws: text, and http(s) links. NOT HTML: the screen puts `value` in a text node and `href`
 * in an anchor with rel="noopener noreferrer". Only http and https are ever links (a javascript: address is plain text).
 */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];
    const trail = TRAIL.exec(url)?.[0] ?? "";
    if (trail) url = url.slice(0, url.length - trail.length);
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
    if (!ok) continue;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({ type: "link", href: url, label: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export function snippet(text: string, max: number = ROOM.snippetChars): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

// ── What a screen is given for a message ───────────────────────────────────────────────────────────────────────────

export type RoomMessageRow = {
  id: string;
  kind: RoomKind;
  body: string;
  parent_id: string | null;
  author_id: string;
  mentions: string[] | null;
  question_owner_id: string | null;
  question_due: string | null;
  question_status: QuestionStatus | null;
  answered_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomFileView = { id: string; name: string; size: number; mime: string | null };

export type RoomMessageView = {
  id: string;
  kind: RoomKind;
  /** null once removed: the text of a removed message is never sent to a screen again. */
  body: string | null;
  removed: boolean;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  mentions: string[];
  question: { owner_id: string | null; owner_name: string | null; due: string | null; status: QuestionStatus; answered_at: string | null } | null;
  files: RoomFileView[];
};

export function toMessageView(r: RoomMessageRow, names: ReadonlyMap<string, string>, files: readonly RoomFileView[] = []): RoomMessageView {
  const removed = r.deleted_at !== null && r.deleted_at !== undefined;
  return {
    id: r.id, kind: r.kind, body: removed ? null : r.body, removed, parent_id: r.parent_id, author_id: r.author_id,
    author_name: names.get(r.author_id) ?? "Colleague", created_at: r.created_at, updated_at: r.updated_at,
    mentions: removed ? [] : r.mentions ?? [],
    question: r.kind === "question" && r.question_status
      ? { owner_id: r.question_owner_id, owner_name: r.question_owner_id ? names.get(r.question_owner_id) ?? null : null, due: r.question_due, status: r.question_status, answered_at: r.answered_at }
      : null,
    files: removed ? [] : [...files],
  };
}

/** The room's header data, as the screen receives it. */
export type RoomPayload = {
  room: { id: string; created_at: string } | null;
  members: { user_id: string; name: string; email: string | null; last_seen_at: string | null; is_you: boolean }[];
  /** Colleagues in the workspace who are not in the room yet (for "Add by name"). */
  candidates: { user_id: string; name: string }[];
  you_are_member: boolean;
  unread: number;
  open_questions: number;
  now: string;
};

/** "Here now", "5 min ago", "3 h ago", a date, or "Not yet": when a member last had the room open. */
export function seenLabel(lastSeenAt: string | null | undefined, now: Date): string {
  if (!lastSeenAt) return "Not yet";
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return "Not yet";
  const mins = Math.floor((now.getTime() - t) / 60_000);
  if (mins < 2) return "Here now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** A text segment split again at the "@label" of each member, so the screen can bold a mention. Pure; the screen draws text nodes. */
export function splitMentions(text: string, labels: readonly string[]): { type: "text" | "mention"; value: string }[] {
  const wanted = [...new Set(labels.map((l) => l.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return [{ type: "text", value: text }];
  const re = new RegExp(`@(?:${wanted.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_])`, "gi");
  const out: { type: "text" | "mention"; value: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > 0 && /[A-Za-z0-9_]/.test(text[at - 1])) continue;
    if (at > last) out.push({ type: "text", value: text.slice(last, at) });
    out.push({ type: "mention", value: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.length ? out : [{ type: "text", value: text }];
}

// ── Polling ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Milliseconds to the next poll: 10 s while visible, 60 s hidden, doubling after each failure up to 2 minutes. */
export function nextPollDelay(args: { hidden: boolean; failures: number }): number {
  const base = args.hidden ? ROOM.hiddenPollMs : ROOM.pollMs;
  const factor = 2 ** Math.min(Math.max(args.failures, 0), 6);
  return Math.min(base * factor, Math.max(ROOM.maxPollMs, base));
}

/** The "changed since" value to send: the last server time seen, a little earlier. null = first load. */
export function pollSince(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  const t = Date.parse(cursor);
  return Number.isNaN(t) ? null : new Date(t - ROOM.overlapMs).toISOString();
}

/** Fold a poll's rows into what the screen holds: by id (the newer copy wins), oldest first. */
export function mergeMessages<T extends { id: string; created_at: string; updated_at: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    const have = byId.get(m.id);
    if (!have || Date.parse(m.updated_at) >= Date.parse(have.updated_at)) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}

// ── Unread ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where "unread" starts for a member: what they last read, else when they joined (history from before they joined is not "new"). */
export const unreadFloor = (m: { last_read_at: string | null; added_at: string }): string => m.last_read_at ?? m.added_at;

/** Messages after `since` by someone else that have not been removed. */
export function countUnread(messages: readonly { author_id: string; created_at: string; deleted_at: string | null }[], since: string, userId: string): number {
  const floor = Date.parse(since);
  return messages.filter((m) => m.author_id !== userId && !m.deleted_at && Date.parse(m.created_at) > floor).length;
}

// ── The e-mail digest ──────────────────────────────────────────────────────────────────────────────────────────────

/** May a digest go to this member now? At most once per 15 minutes (a minute of slack for a scheduler that fires early). */
export function digestDue(args: { lastDigestAt: string | null | undefined; now: Date }): boolean {
  if (!args.lastDigestAt) return true;
  const last = Date.parse(args.lastDigestAt);
  if (Number.isNaN(last)) return true;
  return args.now.getTime() - last >= ROOM.digestGapMs - ROOM.digestSlackMs;
}

/** What a digest reports: messages after the latest of "read", "last digest" and "joined". */
export function digestSince(m: { last_read_at: string | null; last_digest_at: string | null; added_at: string }): string {
  const times = [m.last_read_at, m.last_digest_at, m.added_at].filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((n) => !Number.isNaN(n));
  return new Date(Math.max(...times)).toISOString();
}

export type DigestRoom = { title: string; link: string; count: number; mentioned: boolean; lines: string[] };

/** The digest's wording. Plain text: a colleague's words are quoted, never HTML. */
export function digestMessage(rooms: readonly DigestRoom[]): { subject: string; text: string } {
  const total = rooms.reduce((n, r) => n + r.count, 0);
  const first = rooms[0];
  const subject = (rooms.length === 1
    ? `Deal Room: ${total} new ${total === 1 ? "message" : "messages"} on ${first.title}`
    : `Deal Room: ${total} new messages in ${rooms.length} tenders`).slice(0, 200);
  const parts = rooms.slice(0, ROOM.digestRooms).map((r) => [
    `${r.title}: ${r.count} new ${r.count === 1 ? "message" : "messages"}${r.mentioned ? " (you were mentioned)" : ""}`,
    ...r.lines.map((l) => `  ${l}`),
    `  Open the room: ${r.link}`,
  ].join("\n"));
  const more = rooms.length > ROOM.digestRooms ? [`...and ${rooms.length - ROOM.digestRooms} more`] : [];
  return { subject, text: [...parts, ...more, "", "You are receiving this because you follow these Deal Rooms. At most one summary arrives every 15 minutes."].join("\n\n").replace(/\n\n\n/g, "\n\n") };
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Why a set of files cannot be posted, or null. The type itself is judged on the bytes by the server (the Inbox allow-list). */
export function filesProblem(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > ROOM.maxFiles) return `Up to ${ROOM.maxFiles} files per message`;
  for (const f of files) {
    if (f.size <= 0) return `${f.name} is empty`;
    if (f.size > ROOM.maxFileBytes) return `${f.name} is over ${ROOM.maxFileBytes / 1024 / 1024} MB`;
  }
  return null;
}
