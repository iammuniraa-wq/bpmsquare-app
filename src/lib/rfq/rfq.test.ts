import { describe, it, expect, beforeAll } from "vitest";
import { deriveRfqStatus, bestByLine, landedUnit, cleanResponse, addDays, linkExpiry, htmlToText, stripQuotedReply, refFromSubject } from "./rules";
import {
  signReplyToken, verifyReplyToken, mailCode, mailCodeMatches, subjectTag, parseSubjectTag,
  replyToAddress, parseReplyToAddress,
} from "./token";
import { rfqConfig } from "./types";

beforeAll(() => {
  process.env.RFQ_LINK_SECRET = "test-secret-for-rfq";
});

const SID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER = "11111111-2222-3333-4444-555555555555";

describe("deriveRfqStatus", () => {
  it("keeps hand-set states", () => {
    for (const s of ["draft", "closed", "cancelled"] as const) {
      expect(deriveRfqStatus(s, [{ status: "replied" }], [{ status: "awarded" }])).toBe(s);
    }
  });
  it("follows the suppliers once sent", () => {
    expect(deriveRfqStatus("sent", [{ status: "sent" }, { status: "viewed" }], [{ status: "open" }])).toBe("sent");
    expect(deriveRfqStatus("sent", [{ status: "replied" }, { status: "sent" }], [{ status: "open" }])).toBe("partially_replied");
    expect(deriveRfqStatus("sent", [{ status: "replied" }, { status: "declined" }], [{ status: "open" }])).toBe("replied");
  });
  it("ignores removed and never-sent suppliers", () => {
    expect(deriveRfqStatus("sent", [{ status: "replied" }, { status: "cancelled" }, { status: "pending" }], [{ status: "open" }])).toBe("replied");
  });
  it("is awarded when every live line is decided and one is awarded", () => {
    expect(deriveRfqStatus("replied", [{ status: "replied" }], [{ status: "awarded" }, { status: "no_award" }, { status: "cancelled" }])).toBe("awarded");
    expect(deriveRfqStatus("replied", [{ status: "replied" }], [{ status: "no_award" }])).toBe("replied");
    expect(deriveRfqStatus("replied", [{ status: "replied" }], [{ status: "awarded" }, { status: "open" }])).toBe("replied");
  });
});

describe("comparison", () => {
  it("converts with the buyer's FX and defaults to 1", () => {
    expect(landedUnit({ unit_price: 10, fx_rate: 3.64 })).toBe(36.4);
    expect(landedUnit({ unit_price: 10, fx_rate: null })).toBe(10);
    expect(landedUnit({ unit_price: null, fx_rate: 2 })).toBeNull();
  });
  it("picks the lowest landed price per line and never a no-quote", () => {
    const best = bestByLine([
      { id: "a", rfq_supplier_id: "s1", rfq_line_id: "L1", status: "quoted", unit_price: 100, fx_rate: 1 },
      { id: "b", rfq_supplier_id: "s2", rfq_line_id: "L1", status: "quoted", unit_price: 30, fx_rate: 3.64 },
      { id: "c", rfq_supplier_id: "s3", rfq_line_id: "L1", status: "no_quote", unit_price: 1, fx_rate: 1 },
      { id: "d", rfq_supplier_id: "s1", rfq_line_id: "L2", status: "alternative", unit_price: 5, fx_rate: 1 },
    ]);
    expect(best.get("L1")).toBe("a");
    expect(best.get("L2")).toBe("d");
  });
});

describe("cleanResponse", () => {
  it("skips an empty row rather than storing zero", () => {
    expect(cleanResponse({ rfq_line_id: "L" })).toEqual({ ok: true, value: null });
  });
  it("accepts a quote with commas and normalises currency", () => {
    const r = cleanResponse({ rfq_line_id: "L", unit_price: "1,250.50", currency: "usd", lead_time_days: "14.4", valid_until: "2026-12-31" });
    expect(r.ok && r.value).toMatchObject({ unit_price: 1250.5, currency: "USD", lead_time_days: 14, valid_until: "2026-12-31", status: "quoted" });
  });
  it("refuses zero, negatives and junk", () => {
    expect(cleanResponse({ rfq_line_id: "L", unit_price: 0 }).ok).toBe(false);
    expect(cleanResponse({ rfq_line_id: "L", unit_price: -3 }).ok).toBe(false);
    expect(cleanResponse({ rfq_line_id: "L", unit_price: "abc" }).ok).toBe(false);
    expect(cleanResponse({ rfq_line_id: "L", unit_price: 1e12 }).ok).toBe(false);
  });
  it("takes a no-quote without a price and drops the price if given", () => {
    const r = cleanResponse({ rfq_line_id: "L", status: "no_quote", unit_price: 9 });
    expect(r.ok && r.value).toMatchObject({ status: "no_quote", unit_price: null });
  });
  it("requires a price when the status says quoted", () => {
    expect(cleanResponse({ rfq_line_id: "L", status: "quoted" }).ok).toBe(false);
  });
  it("ignores a bad currency and a bad date", () => {
    const r = cleanResponse({ rfq_line_id: "L", unit_price: 1, currency: "dollars", valid_until: "31/12/2026" });
    expect(r.ok && r.value).toMatchObject({ currency: null, valid_until: null });
  });
});

describe("dates", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-10-30", 5)).toBe("2026-11-04");
  });
  it("expires the link at the end of respond_by + grace", () => {
    expect(new Date(linkExpiry("2026-10-20", 14)).toISOString()).toBe("2026-11-03T23:59:59.000Z");
    const now = Date.parse("2026-10-15T00:00:00Z");
    expect(linkExpiry(null, 14, now)).toBe(now + 60 * 86_400_000);
  });
});

describe("reply token", () => {
  it("round-trips and dies when the nonce rotates", () => {
    const exp = Date.now() + 3600_000;
    const t = signReplyToken(SID, "nonce1", exp)!;
    expect(verifyReplyToken(SID, "nonce1", t)).toEqual({ ok: true, expiresAt: exp });
    expect(verifyReplyToken(SID, "nonce2", t)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyReplyToken(OTHER, "nonce1", t)).toEqual({ ok: false, reason: "invalid" });
  });
  it("reports expiry separately", () => {
    const t = signReplyToken(SID, "n", Date.now() - 1000)!;
    expect(verifyReplyToken(SID, "n", t)).toEqual({ ok: false, reason: "expired" });
  });
  it("refuses garbage", () => {
    for (const bad of ["", ".", "abc.def", "123.x", "9999999999999.%%%"]) {
      expect(verifyReplyToken(SID, "n", bad).ok).toBe(false);
    }
  });
});

describe("mail routing", () => {
  it("gives every recipient its own code", () => {
    const a = mailCode(SID)!;
    expect(a).toMatch(/^[a-z2-9]{10}$/);
    expect(mailCode(OTHER)).not.toBe(a);
    expect(mailCodeMatches(SID, a)).toBe(true);
    expect(mailCodeMatches(SID, a.toUpperCase())).toBe(true);
    expect(mailCodeMatches(OTHER, a)).toBe(false);
  });
  it("parses the subject tag through replies and mangled separators", () => {
    const code = mailCode(SID)!;
    const tag = subjectTag("RFQ-0012", code);
    expect(parseSubjectTag(`Re: AW: ${tag} Steel pipes`)).toEqual({ ref: "RFQ-0012", code });
    expect(parseSubjectTag(`RE: [rfq-0012 - ${code.toUpperCase()}] x`)).toEqual({ ref: "RFQ-0012", code });
    expect(parseSubjectTag("Re: [RFQ-0012] pipes")).toEqual({ ref: "RFQ-0012", code: null });
    expect(parseSubjectTag("no tag here")).toBeNull();
    expect(refFromSubject("Re: quote for RFQ-0099 please")).toBe("RFQ-0099");
  });
  it("round-trips the platform reply-to address and refuses a forged one", () => {
    const addr = replyToAddress(SID, "reply.example.com")!;
    expect(parseReplyToAddress(addr, "reply.example.com")).toBe(SID);
    expect(parseReplyToAddress(`Supplier Desk <${addr.toUpperCase()}>`, "reply.example.com")).toBe(SID);
    expect(parseReplyToAddress(addr, "other.example.com")).toBeNull();
    const forged = addr.replace(/-[a-z2-9]{10}@/, "-aaaaaaaaaa@");
    expect(parseReplyToAddress(forged, "reply.example.com")).toBeNull();
    const swapped = `rfq-${OTHER.replace(/-/g, "")}-${mailCode(SID)}@reply.example.com`;
    expect(parseReplyToAddress(swapped, "reply.example.com")).toBeNull();
  });
});

describe("text helpers", () => {
  it("turns html into readable text", () => {
    expect(htmlToText("<p>Hello<br>there</p><style>x{}</style><div>A &amp; B</div>")).toBe("Hello\nthere\nA & B");
  });
  it("drops quoted history", () => {
    const body = "Price is 12 USD.\n\nOn Mon, 12 Oct 2026, Buyer wrote:\n> please quote\n> thanks";
    expect(stripQuotedReply(body)).toBe("Price is 12 USD.");
    expect(stripQuotedReply("> only quoted")).toBe("> only quoted");
  });
});

describe("rfqConfig", () => {
  it("defaults and clamps", () => {
    expect(rfqConfig(null)).toMatchObject({ mail_mode: "platform", default_response_days: 5, max_reminders: 2 });
    expect(rfqConfig({ mail_mode: "mailbox", mailbox_connector: "mail_server", default_response_days: 999, max_reminders: -1 }))
      .toMatchObject({ mail_mode: "mailbox", mailbox_connector: "mail_server", default_response_days: 90, max_reminders: 0 });
  });
});
