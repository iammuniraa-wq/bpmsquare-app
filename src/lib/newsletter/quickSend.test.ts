import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { createNewsletterCampaign, discardDraftCampaign, prepareNewsletterSend } from "./quickSend";
import { sendNewsletterCampaign } from "./send";
import { resolveBrandKit } from "./brandKit";
import { BUILT_IN_DESIGNS, languageRowsOf } from "./designs";
import { emailOutputFor } from "@/lib/emailOutputRules";
import { fakeDb, uuidIds, type Row } from "@/lib/marketing/testFakeDb";
import type { NewsletterCtx } from "./server";
import type { TenantConfig } from "@/lib/constants";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const N1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const G_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const G_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const eid = BUILT_IN_DESIGNS.find((d) => d.id === "festival-eid")!;
const TOPICS = [{ key: "offers", label: "Offers", hint: "" }];

function world(over: { newsletter?: Row; arabicReady?: boolean; seed?: Record<string, Row[]> } = {}) {
  const [en, ar] = languageRowsOf(eid);
  const arRow = over.arabicReady === false ? ar : { ...ar, review: Object.fromEntries(eid.blocks.map((b) => [b.id, "reviewed" as const])), status: "ready" as const };
  const lang = (l: object) => ({ ...l, tenant_id: T1, newsletter_id: N1 });
  const db = fakeDb({
    newsletters: [{ id: N1, tenant_id: T1, ref: "NWS-0001", name: "Eid", is_template: false, category: "Festival", status: "draft", source_language: "en", topic: "offers", blocks: eid.blocks, ...over.newsletter }],
    newsletter_languages: [lang(en), lang(arRow)],
    newsletter_versions: [], domain_event: [], marketing_campaigns: [],
    marketing_target_groups: [
      { id: G_OWN, tenant_id: T1, name: "OEMs", account_types: [], include_account_ids: ["a1"], exclude_account_ids: [], manual_emails: [], filters: [], match: "all" },
      { id: G_FOREIGN, tenant_id: T2, name: "Theirs", account_types: ["direct"], include_account_ids: [], exclude_account_ids: [], manual_emails: [], filters: [], match: "all" },
    ],
    tenants: [{ id: T1, features: { marketing: true, newsletter_studio: true }, config: { marketing: { topics: TOPICS } } }],
    ...over.seed,
  });
  const client = uuidIds(db.client, ["newsletter_versions"]);
  vi.mocked(createAdminSupabase).mockReturnValue(client as never);
  const ctx: NewsletterCtx = {
    supabase: client, admin: client, tenantId: T1, userId: "u1", role: "admin", email: "u@x.example", isDemo: false,
    config: { marketing: { topics: TOPICS } } as TenantConfig, tenantName: "Al Noor", logoUrl: null, kit: resolveBrandKit({}, { name: "Al Noor" }),
    can: { view: true, create: true, edit: true, delete: true },
  };
  return { db, ctx };
}

describe("preparing a send from the newsletter", () => {
  it("keeps a version itself and inherits the topic and every ready language: nothing is typed again", async () => {
    const { db, ctx } = world();
    const p = await prepareNewsletterSend(ctx, N1, {});
    if (!p.ok) throw new Error(p.error);
    expect(db.tables.newsletter_versions).toHaveLength(1);
    expect(p.fields).toMatchObject({ topic: "offers", languages: ["en", "ar"], fallback_language: "en", newsletter_version_id: p.version.id });
    expect(p.rule.account_types).toEqual(["direct", "end_customer", "oem", "prospect"]);
  });

  it("sending twice without editing reuses the version, and an edit makes the next one", async () => {
    const { db, ctx } = world();
    await prepareNewsletterSend(ctx, N1, {});
    await prepareNewsletterSend(ctx, N1, {});
    expect(db.tables.newsletter_versions).toHaveLength(1);
    db.tables.newsletter_languages[0].subject = "A changed subject";
    await prepareNewsletterSend(ctx, N1, {});
    expect(db.tables.newsletter_versions).toHaveLength(2);
  });

  it("sends only the languages whose every line was accepted", async () => {
    const { ctx } = world({ arabicReady: false });
    const p = await prepareNewsletterSend(ctx, N1, {});
    if (!p.ok) throw new Error(p.error);
    expect(p.fields.languages).toEqual(["en"]);
  });

  it("uses a saved audience of this workspace, and a saved audience of another one is refused", async () => {
    const { ctx } = world();
    const own = await prepareNewsletterSend(ctx, N1, { group_id: G_OWN });
    if (!own.ok) throw new Error(own.error);
    expect(own.rule).toMatchObject({ account_types: [], include_account_ids: ["a1"] });
    const foreign = await prepareNewsletterSend(ctx, N1, { group_id: G_FOREIGN });
    expect(foreign).toMatchObject({ ok: false, status: 422 });
  });

  it("refuses a template, an archived newsletter, another workspace's newsletter and a topic the workspace no longer has", async () => {
    expect(await prepareNewsletterSend(world({ newsletter: { is_template: true } }).ctx, N1, {})).toMatchObject({ ok: false, status: 422 });
    expect(await prepareNewsletterSend(world({ newsletter: { status: "archived" } }).ctx, N1, {})).toMatchObject({ ok: false, status: 422 });
    expect(await prepareNewsletterSend(world({ newsletter: { tenant_id: T2 } }).ctx, N1, {})).toMatchObject({ ok: false, status: 404 });
    expect(await prepareNewsletterSend(world({ newsletter: { topic: "gone" } }).ctx, N1, {})).toMatchObject({ ok: false, status: 422 });
  });
});

describe("the campaign row made behind the panel", () => {
  it("is named after the newsletter and the day, in this workspace, with the newsletter's own topic and languages", async () => {
    const { db, ctx } = world();
    const p = await prepareNewsletterSend(ctx, N1, { account_types: ["oem"], manual_emails: "x@y.example" });
    if (!p.ok) throw new Error(p.error);
    const made = await createNewsletterCampaign(ctx, p, new Date("2026-10-22T09:00:00Z"));
    if (!made.ok) throw new Error(made.error);
    expect(db.tables.marketing_campaigns).toHaveLength(1);
    expect(made.campaign).toMatchObject({
      tenant_id: T1, name: "Eid · 22 Oct 2026", newsletter_version_id: p.version.id, topic: "offers", languages: ["en", "ar"], fallback_language: "en",
      account_types: ["oem"], manual_emails: ["x@y.example"], created_by: "u1",
    });
  });

  it("a draft that was refused before any email left is removed; a sent one and another workspace's are not", async () => {
    const { db, ctx } = world({ seed: {} });
    db.tables.marketing_campaigns.push(
      { id: "c-draft", tenant_id: T1, status: "draft" }, { id: "c-sent", tenant_id: T1, status: "sent" }, { id: "c-other", tenant_id: T2, status: "draft" },
    );
    await discardDraftCampaign(ctx, "c-draft");
    await discardDraftCampaign(ctx, "c-sent");
    await discardDraftCampaign(ctx, "c-other");
    expect(db.tables.marketing_campaigns.map((c) => c.id).sort()).toEqual(["c-other", "c-sent"]);
  });
});

describe("the consent gate still decides, whatever the panel offers", () => {
  const prevSecret = process.env.QUOTE_PUBLIC_LINK_SECRET;
  beforeEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = "send-secret"; });
  afterEach(() => { if (prevSecret === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prevSecret; });

  it("a campaign made by the panel asks the gate about every person for the newsletter's own topic, and a refusal sends nothing", async () => {
    const { db, ctx } = world({
      seed: {
        contacts: [{ id: "k1", tenant_id: T1, account_id: "a1", name: "Layla", email: "layla@one.example", preferred_language: null, created_at: "2026-01-01" }],
        accounts: [{ id: "a1", tenant_id: T1, preferred_language: null }],
        marketing_campaign_recipients: [], email_log: [],
      },
    });
    const p = await prepareNewsletterSend(ctx, N1, {});
    if (!p.ok) throw new Error(p.error);
    const made = await createNewsletterCampaign(ctx, p);
    if (!made.ok) throw new Error(made.error);

    const asked: { contactId: string; topic: string | null }[] = [];
    const mailed: unknown[] = [];
    const result = await sendNewsletterCampaign({
      supabase: ctx.supabase, admin: ctx.admin, tenantId: T1, userId: "u1", userEmail: null,
      campaign: { id: made.campaign.id, name: String(made.campaign.name), topic: made.campaign.topic as string | null, languages: made.campaign.languages as string[], fallback_language: "en", newsletter_version_id: p.version.id },
      version: p.version,
      candidates: [{ account_id: "a1", account_name: "One Co", email: "layla@one.example", marketing_opt_out: false, manual_email: null }],
      resend: { emails: { send: async (m) => { mailed.push(m); return { data: { id: "re_1" }, error: null }; } } },
      output: emailOutputFor({ is_demo: false, config: null }),
      companyName: "Al Noor", fromAddress: "Al Noor <alnoor@bpmsquare.com>", absoluteUrl: async (x) => `https://alnoor.example${x}`,
      gate: async (_t, contactId, topic) => { asked.push({ contactId, topic }); return { ok: false, reason: "no_consent" }; },
      delayMs: 0,
    });
    expect(asked).toEqual([{ contactId: "k1", topic: "offers" }]);
    expect(mailed).toHaveLength(0);
    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(db.tables.marketing_campaign_recipients[0]).toMatchObject({ status: "skipped_no_consent", error: "no_consent" });
  });

  it("the route sends only through sendNewsletterBranch, after both permission checks, and never mails or gates by itself", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app", "api", "newsletters", "[id]", "send", "route.ts"), "utf8");
    expect(src).toMatch(/sendNewsletterBranch\(/);
    expect(src).not.toMatch(/emails\.send|new Resend|canContact|resolveOutbound/);
    const a = src.indexOf('newsletterAccess("edit")');
    const b = src.indexOf('requireMarketingAccess(["marketing"], "edit")');
    const c = src.indexOf("prepareNewsletterSend(");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("the send path keeps its checks in order: opt-out, address, the person, the gate, the language, then the demo redirect", () => {
    const src = readFileSync(join(__dirname, "send.ts"), "utf8");
    const order = ["candidate.marketing_opt_out", "!candidate.email", "skipped_no_contact", "ctx.gate(", "resolveRecipientLanguage({", "resolveOutbound(d.output"].map((s) => src.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});
