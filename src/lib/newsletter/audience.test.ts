import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/newsletter/server", async () => ({ ...(await vi.importActual<object>("@/lib/newsletter/server")), newsletterAccess: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { newsletterAccess } from "@/lib/newsletter/server";
import { planNewsletterAudience, sendNewsletterCampaign } from "./send";
import { groupSkipReasons } from "./audienceWords";
import { explainLanguage, resolveRecipientLanguage } from "./language";
import { renderForPerson } from "./personPreview";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import { POST as previewAs } from "@/app/api/newsletters/preview-as/route";
import type { StoredVersion } from "./server";
import type { MarketingRecipientCandidate } from "@/lib/data/live";
import type { NextRequest } from "next/server";

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const K1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const K2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const KX = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
const V = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const lang = (l: string, subject: string) => ({ lang: l, dir: l === "ar" ? "rtl" as const : "ltr" as const, subject, preheader: "", texts: {}, review: {}, status: "ready" as const });
const version: StoredVersion = {
  id: V, newsletter_id: "n1", version: 1,
  snapshot: { name: "Oct", blocks: [], languages: [lang("en", "Hello {{account_name}}"), lang("ar", "مرحبا {{account_name}}")], kit: {} as never, topic: "offers", open_pixel: false },
  html: { en: '<p>Hi {{contact_name}} of {{account_name}}</p><a href="{{click_0}}">go</a><a href="{{unsubscribe_url}}">u</a>', ar: '<p dir="rtl">أهلاً {{contact_name}}</p><a href="{{click_0}}">go</a>' },
  text: { en: "", ar: "" }, links: [{ url: "https://shop.example/a", label: "go", block_id: "b", block_type: "button" }],
};
const cand = (id: string | null, name: string, email: string | null, over: Partial<MarketingRecipientCandidate> = {}): MarketingRecipientCandidate =>
  ({ account_id: id, account_name: name, email, marketing_opt_out: false, manual_email: id ? null : email, ...over });

const world = () => fakeDb({
  contacts: [
    { id: K1, tenant_id: T, account_id: "a1", name: "Layla Hassan", email: "l@one.example", preferred_language: "ar", created_at: "1" },
    { id: K2, tenant_id: T, account_id: A2, name: "Omar", email: "o@two.example", preferred_language: null, created_at: "1" },
    { id: KX, tenant_id: T2, account_id: "a9", name: "Intruder", email: "x@o.example", created_at: "1" },
  ],
  accounts: [{ id: "a1", tenant_id: T, name: "One Co", preferred_language: null }, { id: A2, tenant_id: T, name: "Two Co", preferred_language: "en" }, { id: "a9", tenant_id: T2, name: "Other Co", preferred_language: null }],
  marketing_campaign_recipients: [], domain_event: [], email_log: [], newsletter_versions: [{ ...version, tenant_id: T }], tenants: [{ id: T, config: {} }],
});

const campaign = { id: "c", name: "Oct", topic: "offers", languages: ["en", "ar"], fallback_language: "en", newsletter_version_id: V };
const gate = async (_t: string, id: string) => (id === K2 ? { ok: false, reason: "no_consent" as const } : { ok: true, reason: "consented" as const });

describe("the before-send audience check", () => {
  it("makes the same decisions as the real send and writes and sends nothing", async () => {
    const db = world();
    const candidates = [cand("a1", "One Co", "l@one.example"), cand(A2, "Two Co", "o@two.example"), cand("a3", "None Ltd", "n@none.example"), cand("a1", "Opted", "z@z.example", { marketing_opt_out: true }), cand(A2, "Blank", null)];
    const plan = await planNewsletterAudience({ admin: db.client, tenantId: T, campaign, version, candidates, gate });
    expect(plan).toEqual({ total: 5, contactable: 1, byLanguage: { ar: 1 }, skipped: { no_consent: 1, no_contact: 1, account_opted_out: 1, no_email: 1 } });
    expect(db.tables.marketing_campaign_recipients).toHaveLength(0);
    expect(db.tables.domain_event).toHaveLength(0);
    expect(db.tables.email_log).toHaveLength(0);

    vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
    process.env.QUOTE_PUBLIC_LINK_SECRET = "s";
    const sent: unknown[] = [];
    const real = await sendNewsletterCampaign({
      supabase: db.client, admin: db.client, tenantId: T, userId: "u", userEmail: null, campaign, version, candidates,
      resend: { emails: { send: async (m) => { sent.push(m); return { data: { id: "r" }, error: null }; } } },
      output: { mode: "partners", redirect_to: "", forced: false }, companyName: "Al Noor", fromAddress: "x <x@y.z>", absoluteUrl: async (p) => `https://h${p}`, gate, delayMs: 0,
    });
    expect({ sent: real.sent, skipped: real.skipped, byLanguage: real.byLanguage }).toEqual({ sent: plan.contactable, skipped: plan.total - plan.contactable, byLanguage: plan.byLanguage });
  });

  it("skips a bounced or complained address when the column exists, and ignores the idea when it does not", async () => {
    const db = world();
    db.tables.contacts[0].email_status = "bounced";
    const candidates = [cand("a1", "One Co", "l@one.example")];
    const withCol = await planNewsletterAudience({ admin: db.client, tenantId: T, campaign, version, candidates, gate });
    expect(withCol.skipped).toEqual({ bounced: 1 });
    const missing = fakeDb({ contacts: [{ id: K1, tenant_id: T, account_id: "a1", name: "L", email: "l@one.example", created_at: "1" }], accounts: [] }, {});
    const probeFails = missing.client.from.bind(missing.client);
    (missing.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = probeFails(t) as { select: (c: string) => unknown };
      const orig = q.select.bind(q);
      q.select = (c: string) => (c === "email_status" ? { eq: () => ({ limit: async () => ({ data: null, error: { code: "42703", message: "column does not exist" } }) }) } : orig(c));
      return q;
    };
    const none = await planNewsletterAudience({ admin: missing.client, tenantId: T, campaign, version, candidates, gate });
    expect(none.contactable).toBe(1);
  });

  it("never reads another tenant's contacts", async () => {
    const db = world();
    await planNewsletterAudience({ admin: db.client, tenantId: T, campaign, version, candidates: [cand("a9", "Other Co", "x@o.example")], gate });
    for (const q of db.queries.filter((x) => x.table === "contacts" || x.table === "accounts")) expect(q.filters.tenant_id).toBe(T);
    const p = await planNewsletterAudience({ admin: db.client, tenantId: T, campaign, version, candidates: [cand("a9", "Other Co", "x@o.example")], gate });
    expect(p.skipped).toEqual({ no_contact: 1 });
  });

  it("groups reasons in plain words with what to do, and leaves empty groups out", () => {
    const g = groupSkipReasons({ no_consent: 3, withdrawn: 1, account_opted_out: 2, no_contact: 4, no_language: 0, bounced: 1, odd_thing: 2 });
    expect(g.map((x) => [x.id, x.count])).toEqual([["no_consent", 3], ["opted_out", 3], ["no_contact", 4], ["bounced", 1], ["odd_thing", 2]]);
    expect(g[0].label).toBe("have not said yes to emails about this topic");
    expect(g[0].fix).toMatch(/consent/i);
    expect(groupSkipReasons({})).toEqual([]);
  });
});

describe("See it as this person", () => {
  it("says which rule picked the language", () => {
    const e = (over: Parameters<typeof explainLanguage>[0]) => explainLanguage(over);
    const inc = ["en", "ar"];
    expect(e({ person: "Layla", choice: resolveRecipientLanguage({ contactLanguage: "ar", included: inc, fallback: "en" }), contactLanguage: "ar" })).toBe("Layla's own preferred language is Arabic, and Arabic is in this send, so Layla gets Arabic.");
    expect(e({ person: "Omar", choice: resolveRecipientLanguage({ accountLanguage: "ar", included: inc, fallback: "en" }), accountLanguage: "ar" })).toContain("has no preferred language, so the company's preferred language is used: Arabic.");
    expect(e({ person: "Sam", choice: resolveRecipientLanguage({ included: inc, fallback: "en" }) })).toContain("Neither Sam nor the company has a preferred language");
    expect(e({ person: "Ravi", choice: resolveRecipientLanguage({ contactLanguage: "hi", included: inc, fallback: "en" }), contactLanguage: "hi" })).toContain("(Hindi) is not in this send, so Ravi gets the fallback for this send: English.");
  });

  it("fills the fields for that person, escapes them, shows real destinations and points the opt-out links nowhere", () => {
    const out = renderForPerson({ ...version, snapshot: version.snapshot }, "en", { account_name: "<b>One</b> Co", company_name: "Al Noor", contact_name: "Layla" })!;
    expect(out.subject).toBe("Hello <b>One</b> Co");
    expect(out.html).toContain("&lt;b&gt;One&lt;/b&gt; Co");
    expect(out.html).toContain('href="https://shop.example/a"');
    expect(out.html).toContain('href="#"');
    expect(out.html).not.toContain("{{");
    expect(renderForPerson(version, "fr", { account_name: "", company_name: "", contact_name: "" })).toBeNull();
  });

  describe("the route", () => {
    const prev = process.env.QUOTE_PUBLIC_LINK_SECRET;
    beforeEach(() => { delete process.env.QUOTE_PUBLIC_LINK_SECRET; });
    afterEach(() => { if (prev === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prev; });

    function call(db: ReturnType<typeof world>, body: Record<string, unknown>) {
      vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
      db.tables.tenants[0].features = { marketing: true, newsletter_studio: true };
      vi.mocked(newsletterAccess).mockResolvedValue({ supabase: db.client, admin: db.client, tenantId: T, tenantName: "Al Noor" } as never);
      return previewAs({ json: async () => ({ newsletter_version_id: V, languages: ["en", "ar"], fallback_language: "en", topic: "offers", ...body }) } as unknown as NextRequest);
    }

    it("shows a contact their own language and writes nothing", async () => {
      const db = world();
      const res = await call(db, { contact_id: K1 });
      const j = await res.json();
      expect(res.status).toBe(200);
      expect(j).toMatchObject({ lang: "ar", via: "contact", company: "One Co" });
      expect(j.html).toContain("أهلاً Layla");
      expect(j.explanation).toContain("Arabic");
      expect(db.tables.marketing_campaign_recipients).toHaveLength(0);
      expect(db.tables.domain_event).toHaveLength(0);
    });

    it("stands a company in by its oldest contact", async () => {
      const j = await (await call(world(), { account_id: A2 })).json();
      expect(j).toMatchObject({ lang: "en", via: "account" });
    });

    it("finds nobody in another workspace", async () => {
      expect((await call(world(), { contact_id: KX })).status).toBe(404);
      expect((await call(world(), { account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8" })).status).toBe(404);
    });
  });
});
