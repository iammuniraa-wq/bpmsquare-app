import { describe, expect, it } from "vitest";
import {
  ALIAS_PREFIX, addDays, askForDrawingReply, attachmentQuality, bodyFrom, canSeeChannel, channelAddress, cleanBody, expiryOnConversion,
  expiryOnReceipt, htmlToPlain, isAliasLocalPart, isExpired, medianFirstReplyMinutes, messageIdList, minutesWord, needsBetterDrawing,
  newAliasKey, normaliseMessageId, normaliseSubject, orderCreateTypes, parseAddress, parseAliasAddress, replyHeaders, replySubject,
  safeFileName, skipReason, sniffAttachment, snippetOf, splitQuoted, summarise, threadKeyFor, visibleChannels,
} from "./rules";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));
const rand = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);

describe("alias addresses", () => {
  it("makes a 16 character key that parses back", () => {
    const alias = newAliasKey(rand(16));
    expect(alias.startsWith(ALIAS_PREFIX)).toBe(true);
    expect(isAliasLocalPart(alias)).toBe(true);
    expect(channelAddress(alias, "In.Example.com")).toBe(`${alias}@in.example.com`);
    expect(parseAliasAddress(`${alias}@in.example.com`, "in.example.com")).toBe(alias);
  });
  it("needs real randomness", () => {
    expect(() => newAliasKey(new Uint8Array(4))).toThrow();
    expect(newAliasKey(rand(16))).not.toBe(newAliasKey(Uint8Array.from(rand(16), (b) => (b + 1) % 256)));
  });
  it("reads an alias out of a display-name recipient, case-insensitively", () => {
    const alias = newAliasKey(rand(16));
    expect(parseAliasAddress(`Fence <${alias.toUpperCase()}@IN.example.com>`, "in.example.com")).toBe(alias);
  });
  it("refuses another domain, a wrong shape and the RFQ reply address", () => {
    const alias = newAliasKey(rand(16));
    expect(parseAliasAddress(`${alias}@other.com`, "in.example.com")).toBeNull();
    expect(parseAliasAddress("inbox-short@in.example.com", "in.example.com")).toBeNull();
    expect(parseAliasAddress(`rfq-${"a".repeat(32)}-abcdefghij@in.example.com`, "in.example.com")).toBeNull();
    expect(parseAliasAddress("not an address", "in.example.com")).toBeNull();
    expect(channelAddress("junk", "in.example.com")).toBeNull();
    expect(channelAddress(alias, "")).toBeNull();
  });
});

describe("parseAddress", () => {
  it("splits name and address", () => {
    expect(parseAddress('"Ali K" <Ali@Example.COM>')).toEqual({ name: "Ali K", address: "ali@example.com" });
    expect(parseAddress("a@b.co")).toEqual({ name: null, address: "a@b.co" });
    expect(parseAddress("junk").address).toBeNull();
    expect(parseAddress(null)).toEqual({ name: null, address: null });
  });
});

describe("loop and auto-reply protection", () => {
  it("ignores auto-replies by header", () => {
    expect(skipReason({ "Auto-Submitted": "auto-replied" }, "a@b.com", "Hi")).toBe("auto-reply");
    expect(skipReason({ "auto-submitted": "no" }, "a@b.com", "Hi")).toBeNull();
    expect(skipReason({ Precedence: "bulk" }, "a@b.com", "Hi")).toBe("auto-reply");
    expect(skipReason({ "X-Auto-Response-Suppress": "DR, OOF, AutoReply" }, "a@b.com", "Hi")).toBe("auto-reply");
    expect(skipReason({ "X-Autoreply": "yes" }, "a@b.com", "Hi")).toBe("auto-reply");
  });
  it("ignores bounces and out-of-office subjects", () => {
    expect(skipReason({ "Return-Path": "<>" }, "x@y.com", "Hi")).toBe("bounce");
    expect(skipReason({}, "MAILER-DAEMON@mx.example.com", "Hi")).toBe("bounce");
    expect(skipReason({}, "a@b.com", "Automatic reply: your enquiry")).toBe("auto-reply");
    expect(skipReason({}, "a@b.com", "RE: Out of office until Monday")).toBe("auto-reply");
    expect(skipReason({}, "a@b.com", "Undeliverable: Re: fence")).toBe("auto-reply");
  });
  it("ignores our own sends: the loop header and our own addresses", () => {
    expect(skipReason({ "X-BPMSquare-Inbox": "1" }, "a@b.com", "Re: fence")).toBe("our own message");
    expect(skipReason({}, "Info <info@fence.com>", "Hi", ["INFO@fence.com"])).toBe("our own address");
    expect(skipReason({}, "customer@x.com", "Hi", ["info@fence.com"])).toBeNull();
  });
  it("keeps a normal customer mail", () => {
    expect(skipReason({ "message-id": "<1@x>" }, "Buyer <buyer@x.com>", "Quote for 300 m of fence", ["info@fence.com", null])).toBeNull();
    expect(skipReason(undefined, null, null)).toBeNull();
  });
});

describe("body text is plain, escaped by the screen, never HTML", () => {
  it("drops scripts, styles, comments and tags", () => {
    const t = htmlToPlain('<p>Hello</p><script>alert(1)</script><style>p{x:y}</style><!-- c --><b>fence</b><br>300&nbsp;m &amp;lt;');
    expect(t).not.toMatch(/alert|<|style|c --/);
    expect(t).toContain("Hello");
    expect(t).toContain("fence");
    expect(t).toContain("&lt;");
  });
  it("decodes entities once, numeric too", () => {
    expect(htmlToPlain("a&#65;&#x42;&amp;amp;")).toBe("aAB&amp;");
  });
  it("removes control characters and caps the size", () => {
    expect(cleanBody("a\u0000b\u0007c")).toBe("abc");
    const long = cleanBody("x".repeat(70_000));
    expect(long.length).toBeLessThan(60_100);
    expect(long.endsWith("[message shortened]")).toBe(true);
  });
  it("prefers the text part, falls back to HTML text", () => {
    expect(bodyFrom({ text: "plain", html: "<b>html</b>" })).toBe("plain");
    expect(bodyFrom({ text: "  ", html: "<b>html</b>" })).toBe("html");
    expect(bodyFrom({})).toBe("");
  });
  it("a script tag typed as text stays text (the screen escapes it)", () => {
    expect(bodyFrom({ text: "<script>alert(1)</script>" })).toBe("<script>alert(1)</script>");
  });
  it("splits a reply from its quoted history", () => {
    const body = "Yes please.\n\nOn Mon, 3 Oct 2026, Sales wrote:\n> Do you need a quote?";
    expect(splitQuoted(body)).toEqual({ fresh: "Yes please.", quoted: "On Mon, 3 Oct 2026, Sales wrote:\n> Do you need a quote?" });
    expect(splitQuoted("only new text")).toEqual({ fresh: "only new text", quoted: "" });
    expect(splitQuoted("> quoted first").fresh).toBe("> quoted first");
  });
  it("summarises the fresh text and snips it at a word", () => {
    const s = summarise(`${"word ".repeat(300)}\n\nOn Mon, X wrote:\n> old`, 100);
    expect(s.length).toBeLessThanOrEqual(101);
    expect(s.endsWith("…")).toBe(true);
    expect(s).not.toContain("old");
    expect(snippetOf("Hello   there")).toBe("Hello there");
    expect(summarise(null)).toBe("");
  });
});

describe("attachments: the allow-list is decided by the file's bytes", () => {
  const pdf = bytes("%PDF-1.7\n", "x".repeat(40));
  const png = bytes([0x89], "PNG\r\n", [0x1a, 0x0a], "xxxxxxxx");
  const jpg = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF-xxxxx");
  const dwg = bytes("AC1032", [0, 0, 0], "xxxxx");
  const dxf = bytes("  0\r\nSECTION\r\n  2\r\nHEADER\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n");
  const docx = bytes("PK", [3, 4], "....[Content_Types].xml....word/document.xml....");
  const xlsx = bytes("PK", [3, 4], "....xl/workbook.xml....");
  const zip = bytes("PK", [3, 4], "....evil/payload.bin....");

  it("accepts every allowed type and names the type from the content", () => {
    expect(sniffAttachment(pdf, "plan.pdf")).toMatchObject({ ok: true, ext: "pdf", mime: "application/pdf" });
    expect(sniffAttachment(png, "photo.png")).toMatchObject({ ok: true, ext: "png" });
    expect(sniffAttachment(jpg, "photo.jpeg")).toMatchObject({ ok: true, ext: "jpg", mime: "image/jpeg" });
    expect(sniffAttachment(dwg, "site.dwg")).toMatchObject({ ok: true, ext: "dwg" });
    expect(sniffAttachment(dxf, "site.dxf")).toMatchObject({ ok: true, ext: "dxf" });
    expect(sniffAttachment(bytes("AutoCAD Binary DXF\r\n", [0x1a, 0]), "b.dxf")).toMatchObject({ ok: true, ext: "dxf" });
    expect(sniffAttachment(docx, "brief.docx")).toMatchObject({ ok: true, ext: "docx" });
    expect(sniffAttachment(xlsx, "list.xlsx")).toMatchObject({ ok: true, ext: "xlsx" });
    expect(sniffAttachment(bytes("a,b\n1,2\n"), "list.csv")).toMatchObject({ ok: true, ext: "csv", mime: "text/csv" });
    expect(sniffAttachment(bytes("some notes"), "notes.txt")).toMatchObject({ ok: true, ext: "txt" });
  });
  it("trusts the bytes over the name: a PNG called .pdf is a PNG", () => {
    expect(sniffAttachment(png, "plan.pdf")).toMatchObject({ ok: true, ext: "png" });
  });
  it("refuses executables, archives, pages and scripts, whatever they are called", () => {
    expect(sniffAttachment(bytes("MZ", [0x90, 0, 3, 0, 0, 0]), "plan.pdf")).toMatchObject({ ok: false });
    expect(sniffAttachment(zip, "plan.docx")).toEqual({ ok: false, reason: "archive" });
    expect(sniffAttachment(bytes("<html><script>x</script></html>"), "notes.txt")).toEqual({ ok: false, reason: "markup" });
    expect(sniffAttachment(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "logo.svg")).toMatchObject({ ok: false });
    expect(sniffAttachment(bytes("<?xml version='1.0'?><svg/>"), "a.txt")).toMatchObject({ ok: false });
    expect(sniffAttachment(bytes("alert(1)"), "x.js")).toEqual({ ok: false, reason: "unknown type" });
    expect(sniffAttachment(new Uint8Array(0), "a.pdf")).toEqual({ ok: false, reason: "empty" });
    expect(sniffAttachment(bytes("ab", [0, 1, 2]), "a.txt")).toMatchObject({ ok: false });
  });
  it("keeps stored file names harmless", () => {
    expect(safeFileName('../..\\a"b<c>.pdf', "pdf")).not.toMatch(/[\\/"<>]/);
    expect(safeFileName("", "pdf")).toBe("file.pdf");
    expect(safeFileName("photo.jpeg", "jpg")).toBe("photo.jpeg");
    expect(safeFileName("plan", "pdf")).toBe("plan.pdf");
  });
  it("labels quality by type and size", () => {
    expect(attachmentQuality("dxf", 5_000).quality).toBe("good");
    expect(attachmentQuality("pdf", 400_000).quality).toBe("good");
    expect(attachmentQuality("pdf", 2_000).quality).toBe("review");
    expect(attachmentQuality("docx", 30_000).quality).toBe("good");
    expect(attachmentQuality("xlsx", 30_000).quality).toBe("good");
    expect(attachmentQuality("jpg", 900_000).quality).toBe("review");
    expect(attachmentQuality("png", 40_000).quality).toBe("poor");
    const dwgQ = attachmentQuality("dwg", 2_000_000);
    expect(dwgQ.quality).toBe("poor");
    expect(dwgQ.note).toMatch(/DXF/);
  });
  it("asks for a better drawing only when none of the files is good", () => {
    expect(needsBetterDrawing([])).toBe(false);
    expect(needsBetterDrawing([{ quality: "poor" }, { quality: "review" }])).toBe(true);
    expect(needsBetterDrawing([{ quality: "poor" }, { quality: "good" }])).toBe(false);
  });
  it("the one-tap reply asks for PDF or DXF and names the company", () => {
    const t = askForDrawingReply({ customerName: "Sara Khan", companyName: "Gulf Fence" });
    expect(t).toMatch(/PDF or a DXF/);
    expect(t).toMatch(/Save As/);
    expect(t.startsWith("Hello Sara,")).toBe(true);
    expect(t.trimEnd().endsWith("Gulf Fence")).toBe(true);
    expect(askForDrawingReply({ companyName: "X" }).startsWith("Hello,")).toBe(true);
  });
});

describe("retention", () => {
  const t0 = new Date("2026-10-01T10:00:00Z");
  it("never converted: 90 days from receipt", () => {
    expect(expiryOnReceipt(t0).toISOString()).toBe("2026-12-30T10:00:00.000Z");
  });
  it("converted: 30 days from the conversion, not from receipt", () => {
    const converted = addDays(t0, 40);
    expect(expiryOnConversion(converted).toISOString()).toBe(addDays(t0, 70).toISOString());
  });
  it("is expired at the boundary, and never twice", () => {
    const row = { expires_at: "2026-12-30T10:00:00.000Z", purged_at: null };
    expect(isExpired(row, new Date("2026-12-30T09:59:59Z"))).toBe(false);
    expect(isExpired(row, new Date("2026-12-30T10:00:00Z"))).toBe(true);
    expect(isExpired({ ...row, purged_at: "2027-01-01T00:00:00Z" }, new Date("2027-06-01"))).toBe(false);
  });
});

describe("threads and replies", () => {
  it("normalises message ids and subjects", () => {
    expect(normaliseMessageId(" <ABC@Mail.X> ")).toBe("abc@mail.x");
    expect(normaliseMessageId("")).toBeNull();
    expect(messageIdList("<a@x> <B@y>")).toEqual(["a@x", "b@y"]);
    expect(normaliseSubject("RE: Fwd: AW: Fence")).toBe("Fence");
    expect(replySubject("Re: RE: Fence")).toBe("Re: Fence");
    expect(replySubject("")).toBe("Re: Your enquiry");
  });
  it("threads by parent, then References root, then In-Reply-To, then own id, then subject", () => {
    expect(threadKeyFor({ messageId: "<z@x>" }, "m:root")).toBe("m:root");
    expect(threadKeyFor({ references: "<r1@x> <r2@x>", inReplyTo: "<r2@x>", messageId: "<z@x>" })).toBe("m:r1@x");
    expect(threadKeyFor({ inReplyTo: "<p@x>", messageId: "<z@x>" })).toBe("m:p@x");
    expect(threadKeyFor({ messageId: "<z@x>" })).toBe("m:z@x");
    expect(threadKeyFor({ subject: "Re: Fence", from: "A <a@b.com>" })).toBe("s:fence|a@b.com");
  });
  it("replies carry In-Reply-To and a bounded References chain", () => {
    expect(replyHeaders({ message_id: "<m3@x>", references: "<m1@x> <m2@x>" })).toEqual({ inReplyTo: "<m3@x>", references: "<m1@x> <m2@x> <m3@x>" });
    expect(replyHeaders({ message_id: "m1@x", references: null })).toEqual({ inReplyTo: "<m1@x>", references: "<m1@x>" });
    const many = Array.from({ length: 14 }, (_, i) => `<r${i}@x>`).join(" ");
    expect(replyHeaders({ message_id: "<last@x>", references: many }).references!.split(" ")).toHaveLength(10);
    expect(replyHeaders({ message_id: null })).toEqual({ inReplyTo: undefined, references: undefined });
  });
});

describe("who sees a channel", () => {
  const open = { role_ids: [], active: true };
  const team = { role_ids: ["r-sales"], active: true };
  it("a channel without a team is for everyone with the Inbox", () => {
    expect(canSeeChannel(open, { isAdmin: false, roleIds: [] })).toBe(true);
  });
  it("a team channel is for its roles and admins only", () => {
    expect(canSeeChannel(team, { isAdmin: false, roleIds: ["r-sales"] })).toBe(true);
    expect(canSeeChannel(team, { isAdmin: false, roleIds: ["r-other"] })).toBe(false);
    expect(canSeeChannel(team, { isAdmin: false, roleIds: [] })).toBe(false);
    expect(canSeeChannel(team, { isAdmin: true, roleIds: [] })).toBe(true);
  });
  it("filters a list", () => {
    const list = [{ id: 1, ...open }, { id: 2, ...team }];
    expect(visibleChannels(list, { isAdmin: false, roleIds: ["x"] }).map((c) => c.id)).toEqual([1]);
    expect(visibleChannels(list, { isAdmin: false, roleIds: ["r-sales"] }).map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("numbers", () => {
  const at = (m: number) => new Date(Date.parse("2026-10-24T08:00:00Z") + m * 60_000).toISOString();
  it("median time to first reply", () => {
    const rows = [
      { thread_key: "a", direction: "in" as const, received_at: at(0) },
      { thread_key: "a", direction: "out" as const, received_at: at(10) },
      { thread_key: "a", direction: "out" as const, received_at: at(500) },
      { thread_key: "b", direction: "in" as const, received_at: at(0) },
      { thread_key: "b", direction: "out" as const, received_at: at(30) },
      { thread_key: "c", direction: "in" as const, received_at: at(0) },
      { thread_key: "d", direction: "out" as const, received_at: at(5) },
    ];
    expect(medianFirstReplyMinutes(rows)).toBe(20);
    expect(medianFirstReplyMinutes(rows.filter((r) => r.thread_key === "c"))).toBeNull();
    expect(medianFirstReplyMinutes([])).toBeNull();
  });
  it("a reply from before the customer's mail is not a first reply", () => {
    expect(medianFirstReplyMinutes([
      { thread_key: "a", direction: "out", received_at: at(-5) },
      { thread_key: "a", direction: "in", received_at: at(0) },
    ])).toBeNull();
  });
  it("words", () => {
    expect(minutesWord(null)).toBe("–");
    expect(minutesWord(0.2)).toBe("under 1 min");
    expect(minutesWord(45)).toBe("45 min");
    expect(minutesWord(130)).toBe("2 h 10 min");
    expect(minutesWord(1500)).toBe("1 d 1 h");
  });
  it("lists the channel's default action first", () => {
    expect(orderCreateTypes(["quote", "case", "lead"], "lead")).toEqual(["lead", "quote", "case"]);
    expect(orderCreateTypes(["quote", "case"], "none")).toEqual(["quote", "case"]);
    expect(orderCreateTypes(["quote", "case"], null)).toEqual(["quote", "case"]);
  });
});
