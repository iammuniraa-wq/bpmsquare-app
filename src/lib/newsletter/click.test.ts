import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { handleClick, handleOpen, userAgentFamily } from "./clickHandler";
import { signClickToken, signOpenToken } from "./linkTokens";
import { fakeDb } from "@/lib/marketing/testFakeDb";

const T1 = "t1";
const T2 = "t2";

function world(over: Partial<Record<string, Record<string, unknown>[]>> = {}, opts: { missingTables?: string[] } = {}) {
  return fakeDb({
    marketing_campaign_recipients: [{ id: "r1", tenant_id: T1, campaign_id: "c1", account_id: "a1", contact_id: "k1", lang: "ar" }],
    marketing_campaigns: [{ id: "c1", tenant_id: T1, newsletter_version_id: "v1", topic: "offers" }],
    newsletter_versions: [{
      id: "v1", tenant_id: T1, newsletter_id: "n1",
      links: [
        { url: "https://shop.example/a?x=1", label: "Buy now", block_type: "button", topic_id: "anchors" },
        { url: "javascript:alert(1)", label: "Bad", block_type: "button" },
        { url: "https://shop.example/p", label: "Product", block_type: "product", product_id: "p1" },
      ],
    }],
    marketing_link_clicks: [],
    domain_event: [],
    tenants: [{ id: T1, config: {} }],
    ...over,
  }, opts);
}

describe("the signed click link", () => {
  const prev = process.env.QUOTE_PUBLIC_LINK_SECRET;
  beforeEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = "click-secret"; });
  afterEach(() => { if (prev === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prev; });

  const click = (db: ReturnType<typeof world>, index: number, token = signClickToken("c1", "r1", index)!) =>
    handleClick({ campaignId: "c1", recipientId: "r1", index: String(index), token, userAgent: "Mozilla/5.0 Chrome/120" }, db.client);

  it("redirects to the address stored at that index, records the click and emits email.clicked", async () => {
    const db = world();
    const out = await click(db, 0);
    expect(out).toEqual({ ok: true, url: "https://shop.example/a?x=1" });
    expect(db.tables.marketing_link_clicks).toHaveLength(1);
    expect(db.tables.marketing_link_clicks[0]).toMatchObject({ tenant_id: T1, campaign_id: "c1", recipient_id: "r1", contact_id: "k1", link_index: 0, topic_id: "anchors", lang: "ar", user_agent_family: "Chrome" });
    const ev = db.tables.domain_event;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ name: "email.clicked", tenant_id: T1, source: "public_link", contact_id: "k1", account_id: "a1", campaign_id: "c1", newsletter_id: "n1", newsletter_version_id: "v1", lang: "ar", topic: "offers" });
    expect(ev[0].payload).toMatchObject({ link_index: 0, label: "Buy now", block_type: "button" });
  });

  it("carries the product on a product-card click", async () => {
    const db = world();
    await click(db, 2);
    expect(db.tables.domain_event[0].payload).toMatchObject({ link_index: 2, product_id: "p1" });
  });

  it("rejects a tampered token before reading anything", async () => {
    const db = world();
    const good = signClickToken("c1", "r1", 0)!;
    for (const [idx, token] of [[0, good.slice(0, -2) + "xx"], [1, good], [0, ""], [0, signClickToken("c1", "r2", 0)!], [0, signClickToken("c2", "r1", 0)!]] as const) {
      expect(await click(db, idx, token)).toEqual({ ok: false });
    }
    expect(db.queries).toHaveLength(0);
    expect(db.tables.marketing_link_clicks).toHaveLength(0);
  });

  it("has no way to take a destination from the request: only an index into the stored list", async () => {
    const db = world();
    expect(await handleClick({ campaignId: "c1", recipientId: "r1", index: "99", token: signClickToken("c1", "r1", 99)! }, db.client)).toEqual({ ok: false });
    expect(await handleClick({ campaignId: "c1", recipientId: "r1", index: "../../x", token: "x" }, db.client)).toEqual({ ok: false });
    expect(await handleClick({ campaignId: "c1", recipientId: "r1", index: "1.5", token: "x" }, db.client)).toEqual({ ok: false });
  });

  it("refuses a stored address that is not a web, email or phone link, even with a valid token", async () => {
    const db = world();
    expect(await click(db, 1)).toEqual({ ok: false });
    expect(db.tables.marketing_link_clicks).toHaveLength(0);
  });

  it("tenant isolation: the campaign and the version are always read for the tenant the recipient belongs to", async () => {
    const db = world({
      // the same ids exist under another tenant: they must never be picked up
      marketing_campaigns: [{ id: "c1", tenant_id: T2, newsletter_version_id: "v1", topic: "offers" }],
    });
    expect(await click(db, 0)).toEqual({ ok: false });

    const db2 = world({ newsletter_versions: [{ id: "v1", tenant_id: T2, newsletter_id: "n9", links: [{ url: "https://evil.example/", label: "x", block_type: "button" }] }] });
    expect(await click(db2, 0)).toEqual({ ok: false });
    expect(db2.tables.marketing_link_clicks).toHaveLength(0);

    const db3 = world();
    await click(db3, 0);
    for (const q of db3.queries.filter((x) => x.table === "marketing_campaigns" || x.table === "newsletter_versions")) expect(q.filters.tenant_id).toBe(T1);
  });

  it("counts a scanner that opens every link once, not many times", async () => {
    const db = world();
    await click(db, 0);
    await click(db, 0);
    expect(db.tables.marketing_link_clicks).toHaveLength(1);
    await click(db, 2);
    expect(db.tables.marketing_link_clicks).toHaveLength(2);
  });

  it("still reaches the page when the clicks table is not there yet", async () => {
    const db = world({}, { missingTables: ["marketing_link_clicks"] });
    expect(await click(db, 0)).toEqual({ ok: true, url: "https://shop.example/a?x=1" });
  });

  it("knows coarse browser families only", () => {
    expect(userAgentFamily("Mozilla/5.0 (iPhone) AppleWebKit Safari/605")).toBe("Safari");
    expect(userAgentFamily("Microsoft Outlook 16")).toBe("Outlook");
    expect(userAgentFamily(null)).toBe("unknown");
  });
});

describe("the opens pixel", () => {
  const prev = process.env.QUOTE_PUBLIC_LINK_SECRET;
  beforeEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = "click-secret"; });
  afterEach(() => { if (prev === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prev; });

  it("records nothing while opens are off (the default)", async () => {
    const db = world();
    await handleOpen({ campaignId: "c1", recipientId: "r1", token: signOpenToken("c1", "r1")! }, db.client);
    expect(db.tables.domain_event).toHaveLength(0);
  });

  it("records email.opened only when the workspace turned opens on, and only for a valid token", async () => {
    const db = world({ tenants: [{ id: T1, config: { marketing: { track_opens: true } } }] });
    await handleOpen({ campaignId: "c1", recipientId: "r1", token: "forged" }, db.client);
    expect(db.tables.domain_event).toHaveLength(0);
    await handleOpen({ campaignId: "c1", recipientId: "r1", token: signOpenToken("c1", "r1")! }, db.client);
    expect(db.tables.domain_event).toHaveLength(1);
    expect(db.tables.domain_event[0]).toMatchObject({ name: "email.opened", tenant_id: T1, lang: "ar" });
  });
});
