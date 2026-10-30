import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { MESSAGE_LIMITS, defaultSubject, excerpt, mergeTimeline, messageToText, parseCompose, suggestRecipients, type InteractionEntry, type RawEntry } from "./rules";

// KAMCO feedback slice 11: the Interactions tab. The pure rules (timeline merge, compose), the shape of migration 0241 (private
// correspondence: RLS on, no policy), and the wiring that keeps a message honest.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");

const entry = (over: Partial<RawEntry> & { key: string }): RawEntry => ({
  kind: "received", direction: "in", at: "2026-10-20T09:00:00Z", who: null, to: null, subject: null, text: null, inbox_id: null, redirected: false, ...over,
});

describe("mergeTimeline", () => {
  it("lists everything newest first", () => {
    const out = mergeTimeline([
      entry({ key: "a", at: "2026-10-20T09:00:00Z" }),
      entry({ key: "b", at: "2026-10-22T09:00:00Z", direction: "out", kind: "message" }),
      entry({ key: "c", at: "2026-10-21T09:00:00Z", kind: "document", direction: "out" }),
    ]);
    expect(out.map((e) => e.key)).toEqual(["b", "c", "a"]);
  });

  it("shows the email a tender came from once: the Inbox row wins and keeps the stored summary when its own text was cleared", () => {
    const out = mergeTimeline([
      entry({ key: "src:m1", kind: "source", text: "They want 40 valves by March", source_email_id: "m1" }),
      entry({ key: "mail:m1", kind: "received", mail_id: "m1", text: null, inbox_id: "m1", subject: "RFQ valves" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "mail:m1", kind: "source", text: "They want 40 valves by March", inbox_id: "m1" });
  });

  it("keeps a stored source whose Inbox message is gone, and an Inbox row that is not a source", () => {
    const out = mergeTimeline([
      entry({ key: "src:old", kind: "source", source_email_id: "gone", text: "summary" }),
      entry({ key: "mail:m2", kind: "received", mail_id: "m2" }),
    ]);
    expect(out.map((e) => e.key).sort()).toEqual(["mail:m2", "src:old"]);
  });

  it("does not leak the internal ties to the screen", () => {
    const out = mergeTimeline([entry({ key: "a", source_email_id: "x", mail_id: "y" })]);
    expect(Object.keys(out[0])).not.toContain("source_email_id");
    expect(Object.keys(out[0])).not.toContain("mail_id");
  });
});

describe("suggestRecipients and defaultSubject", () => {
  const view = (over: Partial<InteractionEntry> & { key: string }): InteractionEntry => ({ kind: "received", direction: "in", at: "2026-10-20T09:00:00Z", who: null, to: null, subject: null, text: null, inbox_id: null, redirected: false, ...over });

  it("offers who wrote to us first, then who we wrote to, each once, never a redirect", () => {
    const list = suggestRecipients([
      view({ key: "1", who: "Khader <Buyer@Ministry.gov.sa>" }),
      view({ key: "2", who: "other@x.com" }),
      view({ key: "3", direction: "out", to: "buyer@ministry.gov.sa, qs@ministry.gov.sa" }),
      view({ key: "4", direction: "out", to: "(redirected; addressed to nobody@x.com)", redirected: true }),
      view({ key: "5", who: "not an address" }),
    ]);
    expect(list).toEqual(["buyer@ministry.gov.sa", "other@x.com", "qs@ministry.gov.sa"]);
  });

  it("starts a reply to the latest mail from the client, else the tender number", () => {
    expect(defaultSubject([view({ key: "1", subject: "RFQ valves" })], "ARB-1", "Valves")).toBe("Re: RFQ valves");
    expect(defaultSubject([view({ key: "1", subject: "Re: RFQ valves" })], "ARB-1", "Valves")).toBe("Re: RFQ valves");
    expect(defaultSubject([view({ key: "1", direction: "out", subject: "Our offer" })], "ARB-1", "Valves")).toBe("ARB-1 · Valves");
    expect(defaultSubject([], null, "Valves")).toBe("Valves");
  });
});

describe("parseCompose", () => {
  const ok = { to: " buyer@ministry.gov.sa ", subject: "Clarification\r\non item 4", body: " Dear all,\r\nPlease confirm. " };

  it("takes one address, a one-line subject and a message", () => {
    expect(parseCompose(ok)).toEqual({ ok: true, value: { to: "buyer@ministry.gov.sa", subject: "Clarification on item 4", body: "Dear all,\nPlease confirm." } });
  });

  it("refuses a missing or invalid part", () => {
    expect(parseCompose({ ...ok, to: "buyer" })).toMatchObject({ ok: false });
    expect(parseCompose({ ...ok, subject: "  " })).toMatchObject({ ok: false });
    expect(parseCompose({ ...ok, body: "" })).toMatchObject({ ok: false });
    expect(parseCompose(null)).toMatchObject({ ok: false });
  });

  it("holds to the column limits", () => {
    expect(parseCompose({ ...ok, subject: "x".repeat(MESSAGE_LIMITS.subjectMax + 1) })).toMatchObject({ ok: false });
    expect(parseCompose({ ...ok, body: "x".repeat(MESSAGE_LIMITS.bodyMax + 1) })).toMatchObject({ ok: false });
  });
});

describe("messageToText and excerpt", () => {
  it("names the address, or the redirect", () => {
    expect(messageToText({ redirected: false, to: ["a@b.co"], intended: ["a@b.co"] })).toBe("a@b.co");
    expect(messageToText({ redirected: true, to: ["t@bpm.com"], intended: ["a@b.co"] })).toBe("(redirected; addressed to a@b.co)");
  });

  it("cuts a long message at a word and says so; short and empty text pass through", () => {
    expect(excerpt("  short  ")).toBe("short");
    expect(excerpt(null)).toBeNull();
    const long = excerpt("word ".repeat(500), 100)!;
    expect(long.length).toBeLessThanOrEqual(101);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("migration 0241", () => {
  const sql = lf(read("supabase/migrations/0241_tender_client_messages.sql"));
  const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

  it("is idempotent, tenant-scoped, RLS on and NO policy (private correspondence reaches nothing but the service role)", () => {
    expect(code).toMatch(/create table if not exists tender_client_messages \([^;]*tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/create index if not exists tender_client_messages_deal_idx/);
    expect(code).toMatch(/alter table tender_client_messages enable row level security/);
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/char_length\(to_text\) between 1 and 300/);
    expect(code).toMatch(/char_length\(subject\) between 1 and 300/);
  });

  it("the bundle carries it verbatim and the ledger lists it as pending", () => {
    expect(lf(read("scripts/run-bundle-49-tender-client-messages-2026-10-29.sql"))).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/run-bundle-49-tender-client-messages-2026-10-29\.sql/);
    expect(project).toMatch(/\(= 0241\)/);
  });

  it("the table is owned by the tender module", () => {
    expect(featureForObject("tender_client_messages")).toBe("gcc_tender");
  });
});

describe("the route and the server", () => {
  const route = read("src/app/api/opportunities/[id]/tender/interactions/route.ts");
  const server = read("src/lib/tender/interactions/server.ts");

  it("opens through the one gate (for writing on POST) and never reads the workspace or the sender from the request", () => {
    expect(route).toMatch(/export async function GET[\s\S]*openTenderDealRequest\(id, false\)[\s\S]*export async function POST[\s\S]*openTenderDealRequest\(id, true\)/);
    expect(route).not.toMatch(/body\.tenant_id|body\.sent_by|body\.actor/);
    expect(route).toMatch(/export const maxDuration = 30/);
  });

  it("sends through resolveOutbound after the table was checked, keeps the body encrypted, and writes the change log", () => {
    expect(server).toContain("sendTenderMailDetailed(");
    expect(server.indexOf('.from("tender_client_messages").select("id")')).toBeLessThan(server.indexOf("sendTenderMailDetailed("));
    expect(server.indexOf("sendTenderMailDetailed(")).toBeLessThan(server.indexOf('.from("tender_client_messages").insert'));
    expect(server).toContain("body: encrypt(input.body)");
    expect(server).toContain('field: "Email to client"');
    expect(server).toContain("Email is not set up on this server");
    const notify = read("src/lib/tender/notify.ts");
    expect(notify.slice(notify.indexOf("export async function sendTenderMailDetailed"))).toMatch(/resolveOutbound\(/);
  });

  it("every query is tenant-scoped, and Inbox mail is drawn with its text only to a person who may open its channel", () => {
    for (const q of ['.from("tender_client_messages").select', '.from("record_sources").select', '.from("inbound_emails").select']) {
      const at = server.indexOf(q);
      expect(at, q).toBeGreaterThan(-1);
      expect(server.slice(at, at + 420), q).toMatch(/\.eq\("tenant_id", tenantId\)/);
    }
    expect(server).toContain("hiddenEmailIds(");
    expect(server).toMatch(/text: canOpen \? excerpt\(/);
    expect(server).toMatch(/inbox_id: canOpen \? e\.id : null/);
    expect(server).toMatch(/tenantHasFeature\(supabase, tenantId, "inbox"\)/);
  });

  it("a missing table is read as 'not there yet', never a crash", () => {
    expect(server).toMatch(/isMissingSchema\(msg\.error\)/);
    expect(server).toMatch(/isMissingRelation\(src\.error\)/);
    expect(server).toMatch(/isMissingRelation\(mail\.error\)/);
  });
});

describe("the explanations", () => {
  it("fit behind an i", () => {
    for (const key of ["interactions", "interactionsCompose", "interactionsInbox"] as const) expect(tipTextProblems(TENDER_TIPS[key]), key).toEqual([]);
  });
});
