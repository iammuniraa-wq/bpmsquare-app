import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { SEND_LIMITS, isEmailAddress, parseEmailSend, parseSend, sendToText } from "./rules";

// KAMCO feedback slice 5: "Sent to client" (migration 0237) and "Send by email". The pure rules, the shape of the migration, and the
// wiring that keeps a send honest: only the server writes, the workspace is the session's, the records table is checked before a send.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0237_tender_bid_sends.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("parseSend (a send recorded by hand)", () => {
  const ok = { channel: "portal", document: "priced_boq", to_text: " Ariba ", note: "", version_no: null };

  it("takes a channel, a document, who it went to and an optional version", () => {
    expect(parseSend(ok, [1, 2])).toEqual({ ok: true, value: { channel: "portal", document: "priced_boq", to_text: "Ariba", note: null, version_no: null } });
    expect(parseSend({ ...ok, version_no: "2", note: "after addendum 3" }, [1, 2])).toMatchObject({ ok: true, value: { version_no: 2, note: "after addendum 3" } });
  });

  it("refuses an unknown channel or document", () => {
    expect(parseSend({ ...ok, channel: "fax" }, [])).toMatchObject({ ok: false });
    expect(parseSend({ ...ok, document: "invoice" }, [])).toMatchObject({ ok: false });
    expect(parseSend(null, [])).toMatchObject({ ok: false });
  });

  it("a version must be one of the deal's own versions", () => {
    expect(parseSend({ ...ok, version_no: 3 }, [1, 2])).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
    expect(parseSend({ ...ok, version_no: 1.5 }, [1, 2])).toMatchObject({ ok: false });
    expect(parseSend({ ...ok, version_no: 1 }, [])).toMatchObject({ ok: false });
  });

  it("holds to the column limits", () => {
    expect(parseSend({ ...ok, to_text: "x".repeat(SEND_LIMITS.toMax + 1) }, [])).toMatchObject({ ok: false });
    expect(parseSend({ ...ok, note: "x".repeat(SEND_LIMITS.noteMax + 1) }, [])).toMatchObject({ ok: false });
  });
});

describe("parseEmailSend", () => {
  it("takes one of the two built files and one address", () => {
    expect(parseEmailSend({ document: "answer_sheet", to: " buyer@ministry.gov.sa ", note: " Please find attached " })).toEqual({ ok: true, value: { document: "answer_sheet", to: "buyer@ministry.gov.sa", note: "Please find attached" } });
  });

  it("refuses a document the tender cannot build, and an address that is not one", () => {
    expect(parseEmailSend({ document: "other", to: "a@b.co" })).toMatchObject({ ok: false });
    for (const to of ["", "buyer", "buyer@", "a b@c.de", "a@b"]) expect(parseEmailSend({ document: "priced_boq", to }), to).toMatchObject({ ok: false });
    expect(isEmailAddress("a@b.co")).toBe(true);
  });
});

describe("sendToText", () => {
  it("names the address, or the redirect on a demo workspace", () => {
    expect(sendToText({ redirected: false, to: ["buyer@x.com"], intended: ["buyer@x.com"] })).toBe("buyer@x.com");
    expect(sendToText({ redirected: true, to: ["test@bpm.com"], intended: ["buyer@x.com"] })).toBe("(redirected; addressed to buyer@x.com)");
  });
});

describe("migration 0237", () => {
  it("is idempotent, tenant-scoped, and SELECT-only (a member must not forge a sent record)", () => {
    expect(code).toMatch(/create table if not exists tender_bid_sends \([^;]*tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/create index if not exists tender_bid_sends_deal_idx/);
    expect(code).toMatch(/alter table tender_bid_sends enable row level security/);
    const policies = [...code.matchAll(/create policy "([^"]+)" on tender_bid_sends for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe("select");
    expect(code).toContain('drop policy if exists "tender_bid_sends: tenant read"');
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("has the columns the code reads, with the spec's checks", () => {
    for (const col of ["version_no", "sent_at", "sent_by", "channel", "document", "to_text", "note", "email_log_id"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(code).toMatch(/channel in \('email', 'portal', 'other'\)/);
    expect(code).toMatch(/document in \('priced_boq', 'answer_sheet', 'other'\)/);
    expect(code).toMatch(/char_length\(to_text\) <= 300/);
    expect(code).toMatch(/char_length\(note\) <= 1000/);
  });

  it("the bundle carries it verbatim and the ledger lists it as pending", () => {
    expect(lf(read("scripts/run-bundle-45-tender-bid-sends-2026-10-29.sql"))).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0237_tender_bid_sends|\(= 0237\)/);
    expect(project).toMatch(/run-bundle-45-tender-bid-sends-2026-10-29\.sql/);
  });

  it("the table is owned by the tender module", () => {
    expect(featureForObject("tender_bid_sends")).toBe("gcc_tender");
  });
});

describe("the routes", () => {
  const sends = read("src/app/api/opportunities/[id]/tender/bids/sends/route.ts");
  const email = read("src/app/api/opportunities/[id]/tender/bids/send-email/route.ts");

  it("both open through the one gate, for writing on POST, and never read the workspace or the sender from the request", () => {
    for (const [name, src] of [["sends", sends], ["send-email", email]] as const) {
      expect(src, name).toMatch(/openTenderDealRequest\(id, (true|false)\)/);
      expect(src, name).not.toMatch(/body\.tenant_id|body\.sent_by|body\.actor/);
    }
    expect(sends).toMatch(/export async function GET[\s\S]*openTenderDealRequest\(id, false\)[\s\S]*export async function POST[\s\S]*openTenderDealRequest\(id, true\)/);
    expect(email).toMatch(/openTenderDealRequest\(id, true\)/);
  });

  it("a hand-recorded version is checked against the deal's own versions before it is saved", () => {
    expect(sends).toMatch(/listBidVersions\(admin, tenantId, id\)/);
    expect(sends).toMatch(/parseSend\([\s\S]*map\(\(v\) => v\.version_no\)/);
  });

  it("an email goes through resolveOutbound (sendTenderMailDetailed), after the records table was checked, and is recorded as an email send", () => {
    expect(email).toContain("sendTenderMailDetailed(");
    expect(email.indexOf("listSends(")).toBeLessThan(email.indexOf("sendTenderMailDetailed("));
    expect(email.indexOf("sendTenderMailDetailed(")).toBeLessThan(email.indexOf("recordSend("));
    expect(email).toMatch(/channel: "email"/);
    expect(email).toMatch(/exportPriced\(gate\.req\)/);
    expect(email).toMatch(/exportAnswerSheet\(gate\.req\)/);
    expect(email).toMatch(/status: 503/);
    expect(email).toContain("Email is not set up on this server");
    expect(email).toMatch(/export const maxDuration = 60/);
    const notify = read("src/lib/tender/notify.ts");
    expect(notify.slice(notify.indexOf("export async function sendTenderMailDetailed"))).toMatch(/resolveOutbound\(/);
  });

  it("the server module is tenant-scoped and writes the change log", () => {
    const src = read("src/lib/tender/bids/sends.ts");
    expect(src).toMatch(/\.eq\("tenant_id", tenantId\)\.eq\("opportunity_id", opportunityId\)/);
    expect(src).toMatch(/tenant_id: tenantId, opportunity_id: opp\.id/);
    expect(src).toContain('field: "Sent to client"');
    expect(src).toContain('objectType: "opportunity_tenders"');
  });

  it("the file is never given a cost: the same writers as the downloads", () => {
    expect(email).not.toMatch(/unit_cost|markup_pct|cost_price/);
  });
});

describe("the explanations", () => {
  it("fit behind an i", () => {
    for (const key of ["sentToClient", "sendByEmail", "bidSubmit"] as const) expect(tipTextProblems(TENDER_TIPS[key]), key).toEqual([]);
  });
});
