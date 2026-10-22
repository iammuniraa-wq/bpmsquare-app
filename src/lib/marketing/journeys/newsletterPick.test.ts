import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { listPickableNewsletters, resolveNewsletterForStep } from "./newsletterPick";
import type { JourneyCtx } from "./access";
import type { NewsletterCtx } from "@/lib/newsletter/server";
import { resolveBrandKit } from "@/lib/newsletter/brandKit";
import { BUILT_IN_DESIGNS, languageRowsOf } from "@/lib/newsletter/designs";
import { fakeDb, uuidIds, type Row } from "@/lib/marketing/testFakeDb";
import type { TenantConfig } from "@/lib/constants";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const N1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const N2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const eid = BUILT_IN_DESIGNS.find((d) => d.id === "festival-eid")!;

function world(seed: Record<string, Row[]> = {}) {
  const [en] = languageRowsOf(eid);
  const db = fakeDb({
    newsletters: [
      { id: N1, tenant_id: T1, name: "Eid", is_template: false, status: "draft", topic: "offers", category: "Festival", source_language: "en", blocks: eid.blocks },
      { id: N2, tenant_id: T2, name: "Theirs", is_template: false, status: "draft", topic: null, category: "Festival", source_language: "en", blocks: [] },
      { id: "t1", tenant_id: T1, name: "A template", is_template: true, status: "draft", topic: null, blocks: [] },
      { id: "a1", tenant_id: T1, name: "Old", is_template: false, status: "archived", topic: null, blocks: [] },
    ],
    newsletter_languages: [{ ...en, tenant_id: T1, newsletter_id: N1 }],
    newsletter_versions: [{ id: "v-old", tenant_id: T1, newsletter_id: N1, version: 1, snapshot: {}, html: {}, text: {}, links: [], languages: [{ lang: "en" }] }],
    domain_event: [],
    ...seed,
  });
  const client = uuidIds(db.client, ["newsletter_versions"]);
  vi.mocked(createAdminSupabase).mockReturnValue(client as never);
  const topics = [{ key: "offers", label: "Offers" }];
  const jctx = { admin: client, tenantId: T1, env: { topics } } as unknown as JourneyCtx;
  const nctx: NewsletterCtx = {
    supabase: client, admin: client, tenantId: T1, userId: "u1", role: "admin", email: null, isDemo: false,
    config: { marketing: { topics: [{ key: "offers", label: "Offers", hint: "" }] } } as TenantConfig, tenantName: "Al Noor", logoUrl: null,
    kit: resolveBrandKit({}, { name: "Al Noor" }), can: { view: true, create: true, edit: true, delete: true },
  };
  return { db, jctx, nctx };
}

describe("the newsletters a journey step can pick", () => {
  it("lists this workspace's newsletters by name, never a template, an archived one or another workspace's", async () => {
    const { jctx, db } = world();
    const r = await listPickableNewsletters(jctx);
    expect(r.newsletters.map((n) => n.name)).toEqual(["Eid"]);
    expect(r.newsletters[0]).toMatchObject({ id: N1, topic: "offers", versionIds: ["v-old"], languages: ["en"] });
    for (const q of db.queries) expect(q.filters.tenant_id).toBe(T1);
  });

  it("answers with a pending flag, not an error, while the studio tables do not exist", async () => {
    const missing = fakeDb({}, { missingTables: ["newsletters"] });
    const r = await listPickableNewsletters({ admin: missing.client, tenantId: T1 } as unknown as JourneyCtx);
    expect(r).toEqual({ newsletters: [], pending: true });
  });
});

describe("picking a newsletter keeps a version for the step", () => {
  it("keeps one and hands back the newsletter's own topic and languages", async () => {
    const { jctx, nctx, db } = world();
    const r = await resolveNewsletterForStep(jctx, nctx, N1);
    if (!r.ok) throw new Error(r.error);
    expect(r.topic).toBe("offers");
    expect(r.languages).toEqual(["en"]);
    expect(db.tables.newsletter_versions.some((v) => v.id === r.version_id)).toBe(true);
  });

  it("picking the same unchanged newsletter again reuses the version", async () => {
    const { jctx, nctx, db } = world({ newsletter_versions: [] });
    const a = await resolveNewsletterForStep(jctx, nctx, N1);
    const b = await resolveNewsletterForStep(jctx, nctx, N1);
    if (!a.ok || !b.ok) throw new Error("not ok");
    expect(b.version_id).toBe(a.version_id);
    expect(db.tables.newsletter_versions.filter((v) => v.newsletter_id === N1)).toHaveLength(1);
  });

  it("drops a topic the workspace's journeys do not have, instead of failing the save later", async () => {
    const { jctx, nctx } = world();
    const r = await resolveNewsletterForStep({ ...jctx, env: { topics: [{ key: "other", label: "Other" }] } } as unknown as JourneyCtx, nctx, N1);
    if (!r.ok) throw new Error(r.error);
    expect(r.topic).toBeNull();
  });

  it("refuses another workspace's newsletter, a template, an archived one and an id that is not one", async () => {
    const { jctx, nctx } = world();
    expect(await resolveNewsletterForStep(jctx, nctx, N2)).toMatchObject({ ok: false, status: 404 });
    expect(await resolveNewsletterForStep(jctx, nctx, "not-a-uuid")).toMatchObject({ ok: false, status: 422 });
    const t = world({ newsletters: [{ id: N1, tenant_id: T1, name: "T", is_template: true, status: "draft", blocks: [] }] });
    expect(await resolveNewsletterForStep(t.jctx, t.nctx, N1)).toMatchObject({ ok: false, status: 422 });
    const a = world({ newsletters: [{ id: N1, tenant_id: T1, name: "A", is_template: false, status: "archived", blocks: [] }] });
    expect(await resolveNewsletterForStep(a.jctx, a.nctx, N1)).toMatchObject({ ok: false, status: 422 });
  });
});
