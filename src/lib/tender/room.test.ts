import { describe, expect, it } from "vitest";
import {
  ROOM, ROOM_CHANNEL, cleanText, countUnread, digestDue, digestMessage, digestSince, filesProblem, linkify, mentionLabels, mentionedUserIds,
  mergeMessages, nextPollDelay, parseMessage, pollSince, questionState, seenLabel, snippet, splitMentions, toMessageView, unreadFloor,
  type RoomMessageRow, type RoomPerson,
} from "./room";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "./tips";

const A = "a", B = "b", C = "c";
const people: RoomPerson[] = [
  { user_id: A, name: "A. Nasser", email: "a@k.test" },
  { user_id: B, name: "Ann", email: "ann@k.test" },
  { user_id: C, name: "Anna", email: "anna@k.test" },
];

describe("reading a posted message", () => {
  it("takes plain text, trims it, and strips control characters", () => {
    expect(parseMessage({ body: "  Hello\u0000 team\r\nsecond line  " })).toEqual({ ok: true, kind: "message", text: "Hello team\nsecond line", parentId: null, ownerId: null, due: null });
    expect(cleanText("a\u0007b\tc")).toBe("ab\tc");
  });

  it("refuses empty text and text over the limit", () => {
    expect(parseMessage({ body: "   " })).toMatchObject({ ok: false });
    expect(parseMessage({})).toMatchObject({ ok: false });
    expect(parseMessage({ body: "x".repeat(ROOM.bodyMax + 1) })).toMatchObject({ ok: false });
    expect(parseMessage({ body: "x".repeat(ROOM.bodyMax) })).toMatchObject({ ok: true });
  });

  it("a plain message needs only a body: no owner, due date or question flag (the Room screen sends nothing else)", () => {
    expect(parseMessage({ body: "Datasheet is in the folder", kind: "message", parent_id: "p1" })).toEqual({ ok: true, kind: "message", text: "Datasheet is in the folder", parentId: "p1", ownerId: null, due: null });
  });

  it("a question carries an owner and a due date, which must be a real date", () => {
    expect(parseMessage({ body: "Who has the datasheet?", kind: "question", owner_id: "u1", due: "2026-11-02" })).toEqual({ ok: true, kind: "question", text: "Who has the datasheet?", parentId: null, ownerId: "u1", due: "2026-11-02" });
    expect(parseMessage({ body: "Q", is_question: true })).toMatchObject({ ok: true, kind: "question" });
    expect(parseMessage({ body: "Q", kind: "question", due: "2/11/2026" })).toMatchObject({ ok: false });
    expect(parseMessage({ body: "Q", kind: "question", due: "2026-13-45" })).toMatchObject({ ok: false });
    // The owner and due date mean nothing on a plain message.
    expect(parseMessage({ body: "hi", owner_id: "u1", due: "2026-11-02" })).toMatchObject({ ok: true, kind: "message", ownerId: null, due: null });
  });

  it("a decision is one line of up to 200 characters, never a reply", () => {
    expect(parseMessage({ body: "Agreed to bid\nwith alternative   cladding", kind: "decision" })).toMatchObject({ ok: true, kind: "decision", text: "Agreed to bid with alternative cladding" });
    expect(parseMessage({ body: "x".repeat(ROOM.decisionMax + 1), kind: "decision" })).toMatchObject({ ok: false });
    expect(parseMessage({ body: "ok", kind: "decision", parent_id: "p" })).toMatchObject({ ok: false });
  });

  it("an unknown kind is refused, and the channel is not a field at all", () => {
    expect(parseMessage({ body: "hi", kind: "announcement" })).toMatchObject({ ok: false });
    const r = parseMessage({ body: "hi", channel: "client", author_id: "x", mentions: ["y"] });
    expect(r).toEqual({ ok: true, kind: "message", text: "hi", parentId: null, ownerId: null, due: null });
    expect(ROOM_CHANNEL).toBe("team");
  });

  it("an open question is overdue after its due date, an answered one never", () => {
    expect(questionState({ question_status: "open", question_due: "2026-10-24" }, "2026-10-25")).toBe("overdue");
    expect(questionState({ question_status: "open", question_due: "2026-10-25" }, "2026-10-25")).toBe("open");
    expect(questionState({ question_status: "open", question_due: null }, "2026-10-25")).toBe("open");
    expect(questionState({ question_status: "answered", question_due: "2020-01-01" }, "2026-10-25")).toBe("answered");
  });
});

describe("mentions", () => {
  it("are read from the text: the member whose @name appears, nobody else", () => {
    expect(mentionedUserIds("Please review @A. Nasser today", people)).toEqual([A]);
    expect(mentionedUserIds("nothing to see", people)).toEqual([]);
    expect(mentionedUserIds("email me at x@Ann.com", people)).toEqual([]);
  });

  it("do not confuse a short name with a longer one that starts the same", () => {
    expect(mentionedUserIds("@Anna can you check", people)).toEqual([C]);
    expect(mentionedUserIds("@Ann and @Anna", people).sort()).toEqual([B, C]);
    expect(mentionedUserIds("@Annabel is not here", people)).toEqual([]);
  });

  it("never mention the author, and ignore case", () => {
    expect(mentionedUserIds("note to self @a. nasser", people, A)).toEqual([]);
    expect(mentionedUserIds("@ann hello", people)).toEqual([B]);
  });

  it("use the e-mail as the label when a name is missing or shared, so a mention is never ambiguous", () => {
    const twins: RoomPerson[] = [{ user_id: "x", name: "Sam", email: "sam1@k.test" }, { user_id: "y", name: "sam", email: "sam2@k.test" }, { user_id: "z", name: null, email: "zed@k.test" }];
    const labels = mentionLabels(twins);
    expect(labels.get("x")).toBe("sam1@k.test");
    expect(labels.get("y")).toBe("sam2@k.test");
    expect(labels.get("z")).toBe("zed@k.test");
    expect(mentionedUserIds("@sam2@k.test please", twins)).toEqual(["y"]);
    expect(mentionedUserIds("@Sam please", twins)).toEqual([]);
  });

  it("split a text so the screen can bold them", () => {
    expect(splitMentions("hi @A. Nasser, and @Ann!", ["A. Nasser", "Ann"])).toEqual([
      { type: "text", value: "hi " }, { type: "mention", value: "@A. Nasser" }, { type: "text", value: ", and " }, { type: "mention", value: "@Ann" }, { type: "text", value: "!" },
    ]);
    expect(splitMentions("plain", ["Ann"])).toEqual([{ type: "text", value: "plain" }]);
    expect(splitMentions("x", [])).toEqual([{ type: "text", value: "x" }]);
  });
});

describe("links in plain text", () => {
  it("turns http and https addresses into links and leaves every other character as text", () => {
    expect(linkify("see https://portal.example.com/t/1, then ask")).toEqual([
      { type: "text", value: "see " }, { type: "link", href: "https://portal.example.com/t/1", label: "https://portal.example.com/t/1" }, { type: "text", value: ", then ask" },
    ]);
  });

  it("never makes a link of a script address, and never emits markup", () => {
    const segs = linkify("click javascript:alert(1) or <img src=x onerror=alert(1)> or data:text/html,<b>x</b>");
    expect(segs.every((s) => s.type === "text")).toBe(true);
    expect(segs.map((s) => (s as { value: string }).value).join("")).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps the text of a link with a quote or angle bracket out of the address", () => {
    const segs = linkify('open https://a.test/x"onmouseover="1');
    const link = segs.find((s) => s.type === "link") as { href: string };
    expect(link.href).toBe("https://a.test/x");
  });

  it("snippets are one line", () => {
    expect(snippet("a\n\nb   c")).toBe("a b c");
    expect(snippet("x".repeat(300)).length).toBe(ROOM.snippetChars);
  });
});

describe("a removed message", () => {
  const row = (over: Partial<RoomMessageRow> = {}): RoomMessageRow => ({
    id: "m1", kind: "message", body: "secret strategy", parent_id: null, author_id: A, mentions: [B], question_owner_id: null, question_due: null, question_status: null,
    answered_at: null, deleted_at: null, created_at: "2026-10-25T09:00:00Z", updated_at: "2026-10-25T09:00:00Z", ...over,
  });
  const names = new Map([[A, "A. Nasser"]]);

  it("shows its text while it stands", () => {
    expect(toMessageView(row(), names)).toMatchObject({ body: "secret strategy", removed: false, author_name: "A. Nasser", mentions: [B] });
  });

  it("is sent to a screen as 'removed' with no text, no mentions and no files", () => {
    const v = toMessageView(row({ deleted_at: "2026-10-25T10:00:00Z" }), names, [{ id: "f1", name: "price.xlsx", size: 10, mime: null }]);
    expect(v).toMatchObject({ body: null, removed: true, mentions: [], files: [] });
    expect(JSON.stringify(v)).not.toContain("secret strategy");
    expect(JSON.stringify(v)).not.toContain("price.xlsx");
  });

  it("a question keeps its owner's name and status", () => {
    const v = toMessageView(row({ kind: "question", question_owner_id: A, question_status: "open", question_due: "2026-11-01" }), names);
    expect(v.question).toEqual({ owner_id: A, owner_name: "A. Nasser", due: "2026-11-01", status: "open", answered_at: null });
  });
});

describe("polling", () => {
  it("polls every 10 seconds while visible and backs off when hidden or failing", () => {
    expect(nextPollDelay({ hidden: false, failures: 0 })).toBe(10_000);
    expect(nextPollDelay({ hidden: true, failures: 0 })).toBe(60_000);
    expect(nextPollDelay({ hidden: false, failures: 1 })).toBe(20_000);
    expect(nextPollDelay({ hidden: false, failures: 2 })).toBe(40_000);
    expect(nextPollDelay({ hidden: false, failures: 9 })).toBe(120_000);
    expect(nextPollDelay({ hidden: true, failures: 5 })).toBe(120_000);
  });

  it("asks for what changed since the last server time, a little earlier, and reads a bad cursor as a first load", () => {
    expect(pollSince(null)).toBeNull();
    expect(pollSince("not a date")).toBeNull();
    expect(pollSince("2026-10-25T09:00:10.000Z")).toBe("2026-10-25T09:00:08.000Z");
  });

  it("folds a poll into what the screen holds: by id, the newer copy wins, oldest first", () => {
    const m = (id: string, created: string, updated: string, body: string) => ({ id, created_at: created, updated_at: updated, body });
    const have = [m("1", "2026-10-25T09:00:00Z", "2026-10-25T09:00:00Z", "one"), m("2", "2026-10-25T09:01:00Z", "2026-10-25T09:01:00Z", "two")];
    const merged = mergeMessages(have, [m("3", "2026-10-25T09:02:00Z", "2026-10-25T09:02:00Z", "three"), m("2", "2026-10-25T09:01:00Z", "2026-10-25T09:05:00Z", "two (changed)"), m("1", "2026-10-25T09:00:00Z", "2026-10-25T08:00:00Z", "stale")]);
    expect(merged.map((x) => x.body)).toEqual(["one", "two (changed)", "three"]);
  });

  it("an overlap re-delivers a row; merging twice changes nothing", () => {
    const m = { id: "1", created_at: "2026-10-25T09:00:00Z", updated_at: "2026-10-25T09:00:00Z" };
    expect(mergeMessages(mergeMessages([], [m]), [m])).toEqual([m]);
  });
});

describe("unread", () => {
  const msgs = [
    { author_id: B, created_at: "2026-10-25T09:00:00Z", deleted_at: null },
    { author_id: A, created_at: "2026-10-25T09:05:00Z", deleted_at: null },
    { author_id: B, created_at: "2026-10-25T09:10:00Z", deleted_at: null },
    { author_id: C, created_at: "2026-10-25T09:15:00Z", deleted_at: "2026-10-25T09:16:00Z" },
  ];

  it("counts other people's messages after what you last read, not your own, not removed ones", () => {
    expect(countUnread(msgs, "2026-10-25T08:00:00Z", A)).toBe(2);
    expect(countUnread(msgs, "2026-10-25T09:05:00Z", A)).toBe(1);
    expect(countUnread(msgs, "2026-10-25T09:30:00Z", A)).toBe(0);
  });

  it("starts at what you read, else when you joined (earlier history is not new to you)", () => {
    expect(unreadFloor({ last_read_at: "2026-10-25T09:00:00Z", added_at: "2026-10-20T00:00:00Z" })).toBe("2026-10-25T09:00:00Z");
    expect(unreadFloor({ last_read_at: null, added_at: "2026-10-20T00:00:00Z" })).toBe("2026-10-20T00:00:00Z");
  });
});

describe("the e-mail digest", () => {
  const now = new Date("2026-10-25T10:00:00Z");

  it("goes at most once per 15 minutes per member (a minute of slack for a scheduler that fires early)", () => {
    expect(digestDue({ lastDigestAt: null, now })).toBe(true);
    expect(digestDue({ lastDigestAt: "2026-10-25T09:59:00Z", now })).toBe(false);
    expect(digestDue({ lastDigestAt: "2026-10-25T09:46:30Z", now })).toBe(false);
    expect(digestDue({ lastDigestAt: "2026-10-25T09:46:00Z", now })).toBe(true);
    expect(digestDue({ lastDigestAt: "2026-10-25T09:45:00Z", now })).toBe(true);
    expect(digestDue({ lastDigestAt: "garbage", now })).toBe(true);
  });

  it("reports messages after the latest of read, last digest and joined", () => {
    expect(digestSince({ last_read_at: "2026-10-25T09:00:00Z", last_digest_at: "2026-10-25T09:30:00Z", added_at: "2026-10-01T00:00:00Z" })).toBe("2026-10-25T09:30:00.000Z");
    expect(digestSince({ last_read_at: "2026-10-25T09:40:00Z", last_digest_at: "2026-10-25T09:30:00Z", added_at: "2026-10-01T00:00:00Z" })).toBe("2026-10-25T09:40:00.000Z");
    expect(digestSince({ last_read_at: null, last_digest_at: null, added_at: "2026-10-01T00:00:00Z" })).toBe("2026-10-01T00:00:00.000Z");
  });

  it("is plain text with a link to the room and who was mentioned", () => {
    const one = digestMessage([{ title: "OPP-2 Pipes", link: "https://k.test/pipeline/1/room", count: 3, mentioned: true, lines: ["A. Nasser: hello", "Ann: ok"] }]);
    expect(one.subject).toBe("Deal Room: 3 new messages on OPP-2 Pipes");
    expect(one.text).toContain("(you were mentioned)");
    expect(one.text).toContain("A. Nasser: hello");
    expect(one.text).toContain("https://k.test/pipeline/1/room");
    const two = digestMessage([
      { title: "T1", link: "l1", count: 1, mentioned: false, lines: [] }, { title: "T2", link: "l2", count: 2, mentioned: false, lines: [] },
    ]);
    expect(two.subject).toBe("Deal Room: 3 new messages in 2 tenders");
  });
});

describe("files", () => {
  it("limits the count, the size, and empty files", () => {
    expect(filesProblem([])).toBeNull();
    expect(filesProblem([{ name: "a.pdf", size: 1000 }])).toBeNull();
    expect(filesProblem(Array.from({ length: ROOM.maxFiles + 1 }, (_, i) => ({ name: `f${i}`, size: 1 })))).toMatch(/Up to 5/);
    expect(filesProblem([{ name: "big.pdf", size: ROOM.maxFileBytes + 1 }])).toMatch(/15 MB/);
    expect(filesProblem([{ name: "empty.pdf", size: 0 }])).toMatch(/empty/);
  });
});

describe("the members list", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  it("says when someone was last here", () => {
    expect(seenLabel(null, now)).toBe("Not yet");
    expect(seenLabel("2026-10-25T09:59:30Z", now)).toBe("Here now");
    expect(seenLabel("2026-10-25T09:40:00Z", now)).toBe("20 min ago");
    expect(seenLabel("2026-10-25T05:00:00Z", now)).toBe("5 h ago");
    expect(seenLabel("2026-10-20T05:00:00Z", now)).toMatch(/20 Oct/);
  });
});

describe("the room's explanations", () => {
  it.each(Object.entries(TENDER_TIPS).filter(([k]) => k.startsWith("room")))("%s fits behind an i", (_k, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});
