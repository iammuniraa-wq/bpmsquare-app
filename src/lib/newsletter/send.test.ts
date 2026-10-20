import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { sendNewsletterCampaign, type SendInput, type CampaignRow } from "./send";
import { verifyClickToken } from "./linkTokens";
import { emailOutputFor } from "@/lib/emailOutputRules";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import type { StoredVersion } from "./server";
import type { MarketingRecipientCandidate } from "@/lib/data/live";

const T = "t1";
const campaign: CampaignRow = { id: "camp", name: "October", topic: "offers", languages: ["en", "ar"], fallback_language: "en", newsletter_version_id: "v1" };

const snapLang = (lang: string, subject: string) => ({ lang, dir: lang === "ar" ? "rtl" as const : "ltr" as const, subject, preheader: "", texts: {}, review: {}, status: "ready" as const });
const version: StoredVersion = {
  id: "v1", newsletter_id: "n1", version: 1,
  snapshot: { name: "October", blocks: [], languages: [snapLang("en", "Hello {{account_name}}"), snapLang("ar", "مرحبا {{account_name}}")], kit: {} as never, topic: "offers", open_pixel: false },
  html: {
    en: '<p>Hi {{account_name}} {{contact_name}}</p><a href="{{click_0}}">go</a><a href="{{unsubscribe_url}}">u</a><a href="{{interest_url}}">i</a>',
    ar: '<p dir="rtl">أهلاً {{account_name}}</p><a href="{{click_0}}">go</a><a href="{{unsubscribe_url}}">u</a>',
  },
  text: { en: "Hi {{account_name}} {{unsubscribe_url}}", ar: "أهلاً {{account_name}} {{unsubscribe_url}}" },
  links: [{ url: "https://shop.example/a", label: "go", block_id: "button1", block_type: "button" }],
};

const cand = (account_id: string | null, name: string, email: string, extra: Partial<MarketingRecipientCandidate> = {}): MarketingRecipientCandidate =>
  ({ account_id, account_name: name, email, marketing_opt_out: false, manual_email: account_id ? null : email, ...extra });

function setup(over: Partial<SendInput> = {}, seed: Record<string, Record<string, unknown>[]> = {}) {
  const db = fakeDb({
    contacts: [
      { id: "k1", tenant_id: T, account_id: "a1", name: "Layla Hassan", email: "layla@one.example", preferred_language: "ar", created_at: "2026-01-01" },
      { id: "k2", tenant_id: T, account_id: "a2", name: "Omar", email: "omar@two.example", preferred_language: null, created_at: "2026-01-01" },
      { id: "kx", tenant_id: "other", account_id: "a9", name: "Intruder", email: "x@other.example", created_at: "2026-01-01" },
    ],
    accounts: [{ id: "a1", tenant_id: T, preferred_language: null }, { id: "a2", tenant_id: T, preferred_language: "en" }],
    marketing_campaign_recipients: [], domain_event: [], email_log: [], marketing_campaigns: [],
    ...seed,
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
  const sent: Record<string, unknown>[] = [];
  const order: string[] = [];
  const gateCalls: { tenantId: string; contactId: string; topic: string | null }[] = [];
  const input: SendInput = {
    supabase: db.client, admin: db.client, tenantId: T, userId: "u1", userEmail: "u@x.example", campaign, version,
    candidates: [cand("a1", "Gulf <b>Steel</b>", "layla@one.example"), cand("a2", "Two Co", "omar@two.example")],
    resend: { emails: { send: async (m) => { order.push("send"); sent.push(m); return { data: { id: "re_1" }, error: null }; } } },
    output: emailOutputFor({ is_demo: false, config: null }),
    companyName: "Al Noor", fromAddress: "Al Noor <alnoor@bpmsquare.com>",
    absoluteUrl: async (p) => `https://alnoor.example${p}`,
    gate: async (tenantId, contactId, topic) => { order.push("gate"); gateCalls.push({ tenantId, contactId, topic }); return contactId === "k2" ? { ok: false, reason: "no_consent" } : { ok: true, reason: "consented" }; },
    delayMs: 0,
    ...over,
  };
  return { db, input, sent, order, gateCalls };
}

describe("sending a newsletter campaign", () => {
  const prev = process.env.QUOTE_PUBLIC_LINK_SECRET;
  beforeEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = "send-secret"; });
  afterEach(() => { if (prev === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prev; });

  it("asks the consent gate about every person, for the campaign's topic, BEFORE anything is sent", async () => {
    const { input, order, gateCalls, sent, db } = setup();
    const r = await sendNewsletterCampaign(input);
    expect(gateCalls).toEqual([{ tenantId: T, contactId: "k1", topic: "offers" }, { tenantId: T, contactId: "k2", topic: "offers" }]);
    expect(order).toEqual(["gate", "send", "gate"]); // k1 gated then sent; k2 gated and refused: no send
    expect(sent).toHaveLength(1);
    expect(r).toMatchObject({ sent: 1, failed: 0, skipped: 1, byLanguage: { ar: 1 } });
    const rows = db.tables.marketing_campaign_recipients;
    expect(rows.find((x) => x.contact_id === "k1")).toMatchObject({ status: "sent", lang: "ar" });
    expect(rows.find((x) => x.contact_id === "k2")).toMatchObject({ status: "skipped_no_consent", error: "no_consent" });
  });

  it("emits email.sent and email.skipped with the common fields, the language and the topic", async () => {
    const { input, db } = setup();
    await sendNewsletterCampaign(input);
    const ev = db.tables.domain_event;
    const sentEv = ev.find((e) => e.name === "email.sent")!;
    expect(sentEv).toMatchObject({ tenant_id: T, contact_id: "k1", account_id: "a1", campaign_id: "camp", newsletter_id: "n1", newsletter_version_id: "v1", lang: "ar", topic: "offers", source: "app" });
    expect(sentEv.payload).toMatchObject({ resend_id: "re_1", redirected: false });
    const skipped = ev.find((e) => e.name === "email.skipped")!;
    expect(skipped).toMatchObject({ contact_id: "k2", topic: "offers" });
    expect(skipped.payload).toEqual({ reason: "no_consent" });
    expect(ev.some((e) => e.name === "campaign.sent")).toBe(true);
  });

  it("resolves a language per person: the contact's, then the account's, then the fallback", async () => {
    const { input, sent } = setup({ gate: async () => ({ ok: true, reason: "consented" }) });
    await sendNewsletterCampaign(input);
    const bySubject = sent.map((m) => m.subject);
    expect(bySubject[0]).toContain("مرحبا"); // k1 prefers Arabic
    expect(bySubject[1]).toBe("Hello Two Co"); // k2: account says English
  });

  it("escapes the account name in the html, fills the links per recipient and signs the click link", async () => {
    const { input, sent } = setup();
    await sendNewsletterCampaign(input);
    const html = String(sent[0].html);
    expect(html).toContain("Gulf &lt;b&gt;Steel&lt;/b&gt;");
    expect(html).not.toContain("<b>Steel");
    expect(html).not.toContain("{{");
    expect(html).toMatch(/\/marketing\/unsubscribe\/a1\//);
    const m = html.match(/\/marketing\/c\/camp\/([^/]+)\/0\/([^"]+)"/)!;
    expect(m).toBeTruthy();
    expect(verifyClickToken("camp", m[1], 0, m[2])).toBe(true);
    expect(String(html)).not.toContain("shop.example"); // the email carries the signed link, not the destination
  });

  it("sets the one-click unsubscribe headers", async () => {
    const { input, sent } = setup();
    await sendNewsletterCampaign(input);
    const h = sent[0].headers as Record<string, string>;
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/alnoor\.example\/api\/marketing\/unsubscribe\/a1\//);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("a demo workspace never reaches a real customer: everything goes to the redirect inbox, with the intended address named", async () => {
    const { input, sent } = setup({ output: emailOutputFor({ is_demo: true, config: { email_output: { mode: "redirect", redirect_to: "qa@bpmsquare.example" } } as never }) });
    await sendNewsletterCampaign(input);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["qa@bpmsquare.example"]);
    expect(String(sent[0].html)).toContain("layla@one.example"); // named as the intended recipient
  });

  it("a demo workspace with no redirect inbox sends nothing at all", async () => {
    const { input, sent, db } = setup({ output: emailOutputFor({ is_demo: true, config: null }) });
    const r = await sendNewsletterCampaign(input);
    expect(sent).toHaveLength(0);
    expect(r.failed).toBe(1);
    expect(db.tables.marketing_campaign_recipients.find((x) => x.contact_id === "k1")).toMatchObject({ status: "failed" });
  });

  it("skips, with a reason, someone who is nobody's contact, an opted-out account and an address with none", async () => {
    const { input, db, sent, gateCalls } = setup({
      candidates: [
        cand("a3", "No Contacts Ltd", "info@none.example"),
        cand(null, "typed@by.hand", "typed@by.hand"),
        cand("a1", "Opted", "layla@one.example", { marketing_opt_out: true }),
        cand("a2", "Empty", "", { email: null }),
      ],
    });
    const r = await sendNewsletterCampaign(input);
    expect(sent).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
    expect(r.skipped).toBe(4);
    expect(db.tables.marketing_campaign_recipients.map((x) => x.status)).toEqual(["skipped_no_contact", "skipped_no_contact", "skipped_opt_out", "skipped_no_email"]);
    expect(db.tables.domain_event.filter((e) => e.name === "email.skipped").map((e) => (e.payload as { reason: string }).reason)).toEqual(["no_contact", "no_contact", "account_opted_out", "no_email"]);
  });

  it("only languages that are ready can be sent: a campaign asking for an unreviewed one never uses it", async () => {
    const v: StoredVersion = { ...version, snapshot: { ...version.snapshot, blocks: [{ id: "h", type: "hero", visible: true, settings: {} }], languages: [snapLang("en", "Hello"), { ...snapLang("ar", "مرحبا"), status: "draft", review: { h: "translated" } }] } };
    const { input, sent } = setup({ version: v, gate: async () => ({ ok: true, reason: "consented" }) });
    await sendNewsletterCampaign(input);
    expect(sent).toHaveLength(2);
    expect(sent.map((m) => m.subject)).toEqual(["Hello", "Hello"]); // nobody got Arabic, not even the person who prefers it
  });

  it("tenant isolation: a contact of another workspace is never matched, and every read names the tenant", async () => {
    const { input, db } = setup({ candidates: [cand("a9", "Intruder Co", "x@other.example")] });
    const r = await sendNewsletterCampaign(input);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(db.tables.marketing_campaign_recipients[0].status).toBe("skipped_no_contact");
    for (const q of db.queries.filter((x) => ["contacts", "accounts"].includes(x.table))) expect(q.filters.tenant_id).toBe(T);
  });

  it("works while preferred_language does not exist yet (migration 0143 pending)", async () => {
    // the first select asks for the column; a database without it answers 42703 and the send retries without it
    let first = true;
    const { input, sent } = setup({ gate: async () => ({ ok: true, reason: "consented" }) });
    const real = input.admin.from.bind(input.admin);
    (input.admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "contacts" || t === "accounts") {
        const q = real(t) as { select: (c: string) => unknown };
        const orig = q.select.bind(q);
        q.select = (cols: string) => {
          if (first && cols.includes("preferred_language")) { first = false; return { eq: () => ({ in: async () => ({ data: null, error: { code: "42703", message: "column does not exist" } }) }) }; }
          return orig(cols);
        };
        return q;
      }
      return real(t);
    };
    const r = await sendNewsletterCampaign(input);
    expect(r.sent).toBe(2);
    expect(sent).toHaveLength(2);
  });
});
