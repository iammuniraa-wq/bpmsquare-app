import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Redesign 2026-10-27 (docs/design/gcc-tender-deals.md section 26): "Convert to Standard Quote" left the header of a tender and lives on the
// Bid tab as "Make a Standard Quote from this version". The same route does it: a tender with { bid_version } copies what was offered in
// that version, keeps the CLIENT's item numbers, links back to the deal (standard_quotes.opportunity_id), and never re-prices. A standard
// deal is untouched. Real route, in-memory database.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
}));

const T1 = "t1";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/changeLog", () => ({ diffForLog: () => [], diffLineItems: () => [], logChange: async () => {} }));
vi.mock("@/lib/events/emitters", () => ({ emitQuoteCreated: async () => {} }));

import { NextRequest } from "next/server";
import { POST as convert } from "./[id]/convert/route";

const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const quotes = () => state.db.rows("standard_quotes");
const quoteLines = () => state.db.rows("standard_quote_lines");

const version = (n: number, lines: Record<string, unknown>[], total: number) => ({
  id: `v${n}`, tenant_id: T1, opportunity_id: OPP, version_no: n, submitted_at: "2026-10-20T09:00:00Z", submitted_by: "u1", currency: "SAR", total, line_count: lines.length, lines, note: null, revision_reason: null,
});
const bl = (item_no: string | null, description: string, qty: number, rate: number) => ({ key: item_no ? `no:${item_no}` : `tx:${description}`, item_no, description, unit: "m", qty, rate, amount: qty * rate, product_ref: null, price_source: "Supplier" });

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }],
    opportunities: [
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipes for Plant 4", account_id: "acc", stage: "submitted", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 40 },
    ],
    opportunity_tenders: [{ opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    opportunity_lines: [
      { id: "l1", tenant_id: T1, opportunity_id: OPP, sl_no: "3.1.2", description: "Pipe 6in (now)", uom: "m", qty: 10, rate: 55, discount_pct: 0, amount: 550 },
      { id: "std-1", tenant_id: T1, opportunity_id: OPP_STD, sl_no: "7", description: "Gate", uom: "Nos", qty: 1, rate: 100, discount_pct: 0, amount: 100 },
      { id: "std-2", tenant_id: T1, opportunity_id: OPP_STD, sl_no: "9", description: "Post", uom: "Nos", qty: 2, rate: 50, discount_pct: 0, amount: 100 },
    ],
    tender_bid_versions: [
      version(1, [bl("3.1.2", "Pipe 6in", 10, 50), bl("A.7", "Flange", 4, 25)], 600),
      version(2, [bl("3.1.2", "Pipe 6in", 10, 52), bl(null, "Freight", 1, 30)], 550),
    ],
    standard_quotes: [],
    standard_quote_lines: [],
  });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true, standard_quotes: true };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Make a Standard Quote from a bid version (a tender)", () => {
  it("copies the chosen version as it was offered, under the client's own item numbers, and links back to the deal", async () => {
    const res = await convert(post({ to: "standard_quote", bid_version: 1 }), ctx());
    expect(res.status).toBe(201);
    const q = quotes();
    expect(q).toHaveLength(1);
    expect(q[0].opportunity_id).toBe(OPP);
    expect(q[0].tenant_id).toBe(T1);
    const lines = quoteLines().filter((l) => l.standard_quote_id === q[0].id);
    expect(lines.map((l) => l.sl_no)).toEqual(["3.1.2", "A.7"]);
    expect(lines.map((l) => [l.description, Number(l.qty), Number(l.rate)])).toEqual([["Pipe 6in", 10, 50], ["Flange", 4, 25]]);
    expect(Number(q[0].subtotal)).toBe(600);
  });

  it("another version gives another quote; a line the client gave no number to falls back to its place, never to a renumbered 1..n of the others", async () => {
    expect((await convert(post({ bid_version: 2 }), ctx())).status).toBe(201);
    const lines = quoteLines();
    expect(lines.map((l) => l.sl_no)).toEqual(["3.1.2", "2"]);
    expect(lines.map((l) => Number(l.rate))).toEqual([52, 30]);
  });

  it("a version that does not exist, or a malformed one, is refused and makes nothing", async () => {
    expect((await convert(post({ bid_version: 9 }), ctx())).status).toBe(404);
    expect((await convert(post({ bid_version: "x" }), ctx())).status).toBe(422);
    expect((await convert(post({ bid_version: 0 }), ctx())).status).toBe(422);
    expect(quotes()).toHaveLength(0);
  });

  it("another workspace's version cannot be reached by number: the version is read under this workspace and this deal", async () => {
    state.db.from("tender_bid_versions").insert({ ...version(3, [bl("Z.1", "Foreign", 1, 1)], 1), id: "vx", tenant_id: "t2" });
    expect((await convert(post({ bid_version: 3 }), ctx())).status).toBe(404);
    expect(quotes()).toHaveLength(0);
  });

  it("without a version a tender still copies its saved lines under their item numbers", async () => {
    expect((await convert(post({}), ctx())).status).toBe(201);
    expect(quoteLines().map((l) => l.sl_no)).toEqual(["3.1.2"]);
  });

  it("a standard deal is unchanged: any bid_version is ignored and its lines are numbered 1..n", async () => {
    expect((await convert(post({ bid_version: 1 }), ctx(OPP_STD))).status).toBe(201);
    expect(quoteLines().map((l) => l.sl_no)).toEqual(["1", "2"]);
    expect(quoteLines().map((l) => l.description)).toEqual(["Gate", "Post"]);
  });

  it("needs the Standard Quotes module", async () => {
    state.features = { pipeline: true, gcc_tender: true };
    expect((await convert(post({ bid_version: 1 }), ctx())).status).toBe(403);
  });
});
