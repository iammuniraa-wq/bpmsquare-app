import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/changeLog", async () => ({ ...(await vi.importActual<object>("@/lib/changeLog")), logChange: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { createVersion, flagChangedSource, loadBundle, loadVersion, saveNewsletter, sendableLanguages, studioEnabled, verifyProducts, type NewsletterCtx } from "./server";
import { resolveBrandKit } from "./brandKit";
import { BUILT_IN_DESIGNS, languageRowsOf } from "./designs";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import type { NewsletterBlock } from "./types";
import type { TenantConfig } from "@/lib/constants";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const P_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const N1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const N2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const eid = BUILT_IN_DESIGNS.find((d) => d.id === "festival-eid")!;

function ctx(db: ReturnType<typeof fakeDb>, tenantId = T1, config = {}): NewsletterCtx {
  // emitEvent() reaches for the service-role client itself; hand it the same in-memory database.
  vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
  return {
    supabase: db.client, admin: db.client, tenantId, userId: "u1", role: "admin", email: "u@x.example", isDemo: false, config: { marketing: { topics: [{ key: "offers", label: "Offers", hint: "" }] }, ...config } as TenantConfig,
    tenantName: "Al Noor", logoUrl: null, kit: resolveBrandKit({}, { name: "Al Noor" }), can: { view: true, create: true, edit: true, delete: true },
  };
}

describe("studioEnabled", () => {
  it("needs BOTH the Marketing module and the platform-admin flag", () => {
    expect(studioEnabled({ marketing: true, newsletter_studio: true })).toBe(true);
    expect(studioEnabled({ marketing: true })).toBe(false);
    expect(studioEnabled({ newsletter_studio: true })).toBe(false);
    expect(studioEnabled({ marketing: true, newsletter_studio: false })).toBe(false);
    expect(studioEnabled(null)).toBe(false);
    expect(studioEnabled(undefined)).toBe(false);
  });
});

describe("tenant isolation", () => {
  const seed = () => fakeDb({
    newsletters: [{ id: N1, tenant_id: T1, name: "Mine", blocks: eid.blocks, is_template: false }, { id: N2, tenant_id: T2, name: "Theirs", blocks: [], is_template: false }],
    newsletter_languages: [{ id: "l1", tenant_id: T1, newsletter_id: N1, lang: "en" }],
    newsletter_versions: [{ id: "v-theirs", tenant_id: T2, newsletter_id: N2, version: 1, snapshot: {}, html: {}, text: {}, links: [] }],
    products: [{ id: P_OWN, tenant_id: T1 }, { id: P_FOREIGN, tenant_id: T2 }],
  });

  it("another tenant's newsletter id finds nothing", async () => {
    const db = seed();
    expect((await loadBundle(ctx(db), N2)).data).toBeNull();
    expect((await loadBundle(ctx(db), N1)).data?.newsletter.name).toBe("Mine");
    for (const q of db.queries) expect(q.filters.tenant_id).toBe(T1);
  });

  it("another tenant's version cannot be loaded", async () => {
    const db = seed();
    expect(await loadVersion(db.client, T1, "v-theirs")).toBeNull();
    expect(await loadVersion(db.client, "not-a-uuid", "v-theirs")).toBeNull();
  });

  it("a product card keeps its product only when it belongs to this tenant", async () => {
    const db = seed();
    const blocks: NewsletterBlock[] = [
      { id: "p1", type: "product", visible: true, settings: { product_id: P_OWN } },
      { id: "p2", type: "product", visible: true, settings: { product_id: P_FOREIGN } },
    ];
    const r = await verifyProducts(ctx(db), blocks);
    expect(r.blocks[0].settings.product_id).toBe(P_OWN);
    expect(r.blocks[1].settings.product_id).toBeUndefined();
    expect(r.dropped).toBe(1);
  });

  it("a save cannot claim another tenant's template as its origin, or a topic the workspace does not have", async () => {
    const db = fakeDb({ newsletters: [{ id: N2, tenant_id: T2, name: "Their template", is_template: true }], newsletter_languages: [], domain_event: [] });
    const rows = languageRowsOf(eid);
    const saved = await saveNewsletter(ctx(db), null, { name: "Mine", blocks: eid.blocks, languages: rows, template_origin_id: N2 });
    expect("id" in saved).toBe(true);
    const mine = db.tables.newsletters.find((n) => n.name === "Mine")!;
    expect(mine.template_origin_id).toBeNull();
    expect(mine.tenant_id).toBe(T1);
    await expect(saveNewsletter(ctx(db), null, { name: "X", blocks: eid.blocks, languages: rows, topic: "nonsense" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("saving", () => {
  it("stores only what the gates allow: plain words, a closed set of blocks, languages with their direction", async () => {
    const db = fakeDb({ newsletters: [], newsletter_languages: [], domain_event: [] });
    const rows = languageRowsOf(eid);
    rows[0].texts.text1 = { text: "Hello <script>alert(1)</script> there", sneaky: "x" } as never;
    const blocks = [...eid.blocks, { id: "x", type: "iframe", visible: true, settings: {} }] as never;
    const saved = await saveNewsletter(ctx(db), null, { name: "Eid", blocks, languages: rows });
    if (!("id" in saved)) throw new Error("not saved");
    const n = db.tables.newsletters[0];
    expect((n.blocks as NewsletterBlock[]).map((b) => b.type)).toEqual(["header", "hero", "text", "footer"]);
    expect(n.ref).toMatch(/^NWS-\d{4}$/);
    expect(n.source_language).toBe("en");
    const en = db.tables.newsletter_languages.find((l) => l.lang === "en")!;
    expect(JSON.stringify(en.texts)).not.toContain("<script>");
    expect(JSON.stringify(en.texts)).not.toContain("sneaky");
    const ar = db.tables.newsletter_languages.find((l) => l.lang === "ar")!;
    expect(ar.dir).toBe("rtl");
    expect(ar.status).toBe("draft"); // its blocks are still "translated"
    expect(db.tables.domain_event.some((e) => e.name === "newsletter.created")).toBe(true);
  });

  it("refuses a design with no English words", async () => {
    const db = fakeDb({ newsletters: [], newsletter_languages: [], domain_event: [] });
    const rows = languageRowsOf(eid).filter((r) => r.lang === "ar");
    await expect(saveNewsletter(ctx(db), null, { name: "No English", blocks: eid.blocks, languages: rows })).rejects.toMatchObject({ status: 422 });
  });

  it("editing the English flags the same block in the other languages for a second look", () => {
    const [en, ar] = languageRowsOf(eid);
    const reviewed = { ...ar, review: Object.fromEntries(eid.blocks.map((b) => [b.id, "reviewed" as const])), status: "ready" as const };
    const changedEn = { ...en, texts: { ...en.texts, text1: { text: "A changed paragraph." } } };
    const [out] = flagChangedSource(en, changedEn, [reviewed], eid.blocks);
    expect(out.review.text1).toBe("translated");
    expect(out.review.hero1).toBe("reviewed");
    expect(out.status).toBe("draft");
  });
});

describe("versions", () => {
  const bundle = () => {
    const [en, ar] = languageRowsOf(eid);
    const arReviewed = { ...ar, review: Object.fromEntries(eid.blocks.map((b) => [b.id, "reviewed" as const])), status: "ready" as const };
    return { newsletter: { id: N1, ref: "NWS-0001", name: "Eid", is_template: false, category: "Festival", status: "draft", source_language: "en", topic: "offers", blocks: eid.blocks, brand_kit: null, built_in_origin: null, template_origin_id: null, custom_data: null, created_by: null, created_at: "", updated_at: "" } as never, languages: [en, arReviewed], versions: [] };
  };

  it("keeps an immutable copy with the html per language, the tokens in place and the link list", async () => {
    const db = fakeDb({ newsletter_versions: [], domain_event: [] });
    const r = await createVersion(ctx(db), bundle());
    if (!("id" in r)) throw new Error("missing");
    expect(r).toMatchObject({ version: 1, reused: false });
    const row = db.tables.newsletter_versions[0];
    expect(row.tenant_id).toBe(T1);
    expect(Object.keys(row.html as object)).toEqual(["en", "ar"]);
    expect((row.html as Record<string, string>).en).toContain("{{account_name}}");
    expect((row.html as Record<string, string>).en).toContain("{{unsubscribe_url}}");
    expect((row.html as Record<string, string>).ar).toContain('dir="rtl"');
    expect(db.tables.domain_event.some((e) => e.name === "newsletter.version_created")).toBe(true);
  });

  it("does not make a new number when nothing changed, and makes the next one when something did", async () => {
    const db = fakeDb({ newsletter_versions: [], domain_event: [] });
    const first = await createVersion(ctx(db), bundle());
    const again = await createVersion(ctx(db), bundle());
    if (!("id" in first) || !("id" in again)) throw new Error("missing");
    expect(again).toMatchObject({ id: first.id, version: 1, reused: true });
    expect(db.tables.newsletter_versions).toHaveLength(1);
    const b = bundle();
    b.languages[0].subject = "A new subject";
    const next = await createVersion(ctx(db), b);
    if (!("id" in next)) throw new Error("missing");
    expect(next.version).toBe(2);
  });

  it("tells a campaign which languages are sendable: only those with every line reviewed", async () => {
    const db = fakeDb({ newsletter_versions: [], domain_event: [] });
    const b = bundle();
    b.languages[1] = languageRowsOf(eid)[1]; // Arabic back to "translated"
    const r = await createVersion(ctx(db), b);
    if (!("id" in r)) throw new Error("missing");
    expect(sendableLanguages(db.tables.newsletter_versions[0] as unknown as Parameters<typeof sendableLanguages>[0])).toEqual(["en"]);
  });

  it("reports a missing table instead of throwing", async () => {
    const db = fakeDb({}, { missingTables: ["newsletter_versions"] });
    expect(await createVersion(ctx(db), bundle())).toEqual({ missing: true });
  });
});
