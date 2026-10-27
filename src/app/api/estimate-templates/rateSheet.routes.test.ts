import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

// The rate-sheet import routes: who may call them, what files they take, what they write, and that nothing reaches another workspace.
// The session client is a small in-memory database that answers like PostgREST (filters are ANDed), so a missing tenant filter shows
// up as another tenant's row being read or changed.

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  db: { products: [] as Record<string, unknown>[] },
  calls: [] as { op: string; table: string; payload?: unknown; filters: [string, unknown][] }[],
  logs: [] as Record<string, unknown>[],
  role: "admin" as "admin" | "member",
  tenantId: "tenant-a",
  access: "ok" as "ok" | "no_module",
  seq: 7,
  config: { currency: "SAR", rfq: { price_valid_days: 180 } } as Record<string, unknown>,
}));

vi.mock("@/lib/changeLog", () => ({
  logChange: vi.fn(),
  logChangeBatch: vi.fn(async (_s: unknown, rows: Record<string, unknown>[]) => { state.logs.push(...rows); }),
}));

vi.mock("@/lib/masterRef", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/masterRef")>();
  return { ...orig, nextMasterRefSeq: vi.fn(async () => state.seq) };
});

vi.mock("@/lib/supabase-server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/supabase-server")>();
  return {
    ...orig,
    createAdminSupabase: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { config: state.config }, error: null }) }) }) }),
    }),
  };
});

vi.mock("@/lib/estimator/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/estimator/server")>();
  const fake = {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let op = "select";
      let payload: unknown;
      let range: [number, number] | null = null;
      const rows = () => (state.db as Record<string, Row[]>)[table] ?? [];
      const hit = (r: Row) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
      const run = (): { data: unknown; error: null } => {
        state.calls.push({ op, table, payload, filters: [...filters] });
        if (op === "insert") {
          const added = (payload as Row[]).map((p, i) => ({ id: `new-${rows().length + i}`, ...p }));
          rows().push(...added);
          return { data: added, error: null };
        }
        if (op === "update") {
          for (const r of rows().filter(hit)) Object.assign(r, payload);
          return { data: null, error: null };
        }
        const found = rows().filter(hit);
        return { data: range ? found.slice(range[0], range[1] + 1) : found, error: null };
      };
      const q: Record<string, unknown> = {
        select() { return q; },
        insert(p: unknown) { op = "insert"; payload = p; return q; },
        update(p: unknown) { op = "update"; payload = p; return q; },
        eq(k: string, v: unknown) { filters.push([k, v]); return q; },
        in(k: string, v: unknown[]) { filters.push([k, v]); return q; },
        order() { return q; },
        range(a: number, b: number) { range = [a, b]; return q; },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve); },
      };
      return q;
    },
  };
  return {
    ...orig,
    estimatorAccess: vi.fn(async () => {
      if (state.access === "no_module") throw { status: 404, message: "Not found" };
      return { supabase: fake, tenantId: state.tenantId, userId: "u1", role: state.role, email: "a@b.c" };
    }),
  };
});

import { POST as PREVIEW } from "./rate-sheet/preview/route";
import { GET, POST as APPLY } from "./rate-sheet/route";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const seed = () => {
  state.db.products = [
    {
      id: A, tenant_id: "tenant-a", name: "Steel pipe DN300 (illustrative)", sku: "EST-PIPE-STEEL-300", uom: "m", cost_price: 340, cost_price_as_of: null,
      description: "ILLUSTRATIVE placeholder cost, not a supplier's price. Import a rate sheet to replace it.", custom_data: { est_kind: "pipe_supply", illustrative: true, cost_source: "Illustrative placeholder" }, status: "active", created_at: "1",
    },
    { id: A2, tenant_id: "tenant-a", name: "Isolation valve DN300", sku: "EST-VLV-300", uom: "nr", cost_price: 3100, cost_price_as_of: "2026-01-02", description: null, custom_data: null, status: "active", created_at: "2" },
    // The same SKU in ANOTHER workspace: it must never be read, matched or written.
    { id: B, tenant_id: "tenant-b", name: "Steel pipe DN300", sku: "EST-PIPE-STEEL-300", uom: "m", cost_price: 111, cost_price_as_of: "2026-09-01", description: null, custom_data: null, status: "active", created_at: "3" },
  ];
};

// "Today" is fixed so the stale rows do not depend on the day the tests run.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
  seed();
  state.calls = []; state.logs = []; state.role = "admin"; state.tenantId = "tenant-a"; state.access = "ok"; state.seq = 7;
  state.config = { currency: "SAR", rfq: { price_valid_days: 180 } };
});

afterEach(() => { vi.useRealTimers(); });

const csv = (text: string, name = "rates.csv") => new File([text], name, { type: "text/csv" });
const req = (file: File | null, extra: Record<string, string> = {}, path = "rate-sheet") => {
  const f = new FormData();
  if (file) f.set("file", file);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return new NextRequest(`http://x/api/estimate-templates/${path}`, { method: "POST", body: f });
};
const OK_CSV = "SKU,Item,Unit,Rate,Currency,Supplier,As of\nEST-PIPE-STEEL-300,Steel pipe DN300,m,355.5,SAR,Gulf Pipes,2026-01-01\nEST-VLV-300,Isolation valve DN300,nr,3200,SAR,Gulf Pipes,2026-10-10\nNEW-77,Stainless sink,nr,900,SAR,Kitchen Co,2026-10-05\n";
const writes = () => state.calls.filter((c) => c.op === "insert" || c.op === "update");

describe("who may use it", () => {
  it("only an administrator: a member gets 403 on all three calls and nothing is read or written", async () => {
    state.role = "member";
    expect((await PREVIEW(req(csv(OK_CSV), {}, "rate-sheet/preview"))).status).toBe(403);
    expect((await APPLY(req(csv(OK_CSV)))).status).toBe(403);
    expect((await GET()).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("a workspace without the estimator module gets 404, as every estimator endpoint does", async () => {
    state.access = "no_module";
    expect((await PREVIEW(req(csv(OK_CSV)))).status).toBe(404);
    expect((await APPLY(req(csv(OK_CSV)))).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });
});

describe("what files it takes", () => {
  const status = async (file: File | null, extra: Record<string, string> = {}) => (await PREVIEW(req(file, extra))).status;

  it("refuses a missing file, an empty one, one over 5 MB, and any type but .xlsx and .csv", async () => {
    expect(await status(null)).toBe(400);
    expect(await status(csv(""))).toBe(400);
    expect(await status(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv"))).toBe(413);
    expect(await status(new File(["%PDF-1.4"], "rates.pdf", { type: "application/pdf" }))).toBe(415);
    expect(await status(new File([new Uint8Array([1, 2, 3, 4, 5])], "rates.xls"))).toBe(415);
    expect(await status(new File(["x"], "rates.exe"))).toBe(415);
    expect(await status(new File(["<svg onload=alert(1)>"], "rates.svg", { type: "image/svg+xml" }))).toBe(415);
    expect(await status(new File(["this is not a zip"], "rates.xlsx"))).toBe(415);
    expect(await status(new File([new Uint8Array([97, 0, 98])], "rates.csv"))).toBe(415);
    expect(state.calls).toEqual([]);
  });

  it("refuses an as-of date that is not a real date or lies in the future", async () => {
    expect(await status(csv(OK_CSV), { as_of: "2026-13-45" })).toBe(422);
    expect(await status(csv(OK_CSV), { as_of: "yesterday" })).toBe(422);
    expect(await status(csv(OK_CSV), { as_of: "2999-01-01" })).toBe(422);
    expect(await status(csv(OK_CSV), { as_of: "2026-10-01" })).toBe(200);
  });

  it("says what a rate sheet needs when it finds no header or no priced row", async () => {
    const noHeader = await PREVIEW(req(csv("Name,Qty\nSand,5\n")));
    expect(noHeader.status).toBe(422);
    expect((await noHeader.json()).error).toContain("header row");
    const noRows = await PREVIEW(req(csv("Item,Rate\nHeading only,\n")));
    expect(noRows.status).toBe(422);
  });
});

describe("preview", () => {
  it("reads the sheet, matches it against THIS workspace's catalogue only, and writes nothing", async () => {
    const res = await PREVIEW(req(csv(OK_CSV), { as_of: "2026-10-20" }));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.currency).toBe("SAR");
    expect(view.validity_days).toBe(180);
    expect(view.rows).toHaveLength(3);
    const [pipe, valve, sink] = view.rows;
    expect(pipe.status).toBe("exact");
    expect(pipe.default_product_id).toBe(A);                 // tenant-a's product, not tenant-b's with the same SKU
    expect(pipe.suggestions.map((s: { product_id: string }) => s.product_id)).not.toContain(B);
    expect(pipe.stale).toBe(true);                           // 2026-01-01 is more than 180 days before today
    expect(pipe.suggestions[0]).toMatchObject({ current_rate: 340, illustrative: true });
    expect(valve.status).toBe("exact");
    expect(valve.stale).toBe(false);
    expect(sink.status).toBe("none");
    expect(view.counts).toMatchObject({ rows: 3, ready: 2, needs_choice: 1, not_applied: 0, stale: 1 });
    expect(JSON.stringify(view)).not.toContain(B);
    expect(writes()).toEqual([]);
    expect(state.logs).toEqual([]);
    for (const c of state.calls) expect(c.filters).toContainEqual(["tenant_id", "tenant-a"]);
  });

  it("the validity days come from the workspace's RFQ setting", async () => {
    state.config = { currency: "SAR", rfq: { price_valid_days: 400 } };
    let view = await (await PREVIEW(req(csv(OK_CSV)))).json();
    expect(view.validity_days).toBe(400);
    expect(view.rows[0].stale).toBe(false);                  // 2026-01-01 is 298 days before 2026-10-26
    state.config = { currency: "SAR", rfq: { price_valid_days: 30 } };
    view = await (await PREVIEW(req(csv(OK_CSV), { as_of: "2026-09-01" }))).json();
    expect(view.validity_days).toBe(30);
    expect(view.rows[0].stale).toBe(true);
    expect(view.rows[1].stale).toBe(false);                  // 2026-10-10 is 16 days old
    expect(view.rows[1].as_of_used).toBe("2026-10-10");
    const noDate = await (await PREVIEW(req(csv("Item,Rate\nSteel pipe DN300,5\n"), { as_of: "2026-09-01" }))).json();
    expect(noDate.rows[0]).toMatchObject({ as_of_used: "2026-09-01", stale: true, stale_text: "stale, 55 days old" });   // 30 days in September + 25 in October
  });

  it("shows a row in another currency as not applied", async () => {
    const view = await (await PREVIEW(req(csv("Item,Rate,Currency\nSteel pipe DN300,500,EUR\n")))).json();
    expect(view.rows[0].status).toBe("blocked");
    expect(view.rows[0].reason).toContain("EUR");
    expect(view.counts.not_applied).toBe(1);
  });
});

describe("apply", () => {
  it("updates the catalogue as chosen: rate, date, source, history, the illustrative mark gone; logs each change; counts the stale one", async () => {
    const res = await APPLY(req(csv(OK_CSV, "gulf-oct.csv"), { as_of: "2026-10-20" }));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.summary).toMatchObject({ updated: 2, added: 0, skipped: 1, errors: 0, stale: 1 });

    const pipe = (state.db.products as Row[]).find((p) => p.id === A)!;
    expect(pipe.cost_price).toBe(355.5);
    expect(pipe.cost_price_as_of).toBe("2026-01-01");
    expect(pipe.name).toBe("Steel pipe DN300");
    expect(pipe.description).toBeNull();
    const custom = pipe.custom_data as Record<string, unknown>;
    expect(custom.illustrative).toBeUndefined();
    expect(custom).toMatchObject({ est_kind: "pipe_supply", cost_supplier: "Gulf Pipes", cost_source: "Rate sheet gulf-oct.csv" });
    expect(custom.previous_cost).toMatchObject({ cost_price: 340, as_of: null, source: "Illustrative placeholder" });

    const valve = (state.db.products as Row[]).find((p) => p.id === A2)!;
    expect(valve.cost_price).toBe(3200);
    expect(valve.cost_price_as_of).toBe("2026-10-10");
    expect((valve.custom_data as Record<string, unknown>).previous_cost).toMatchObject({ cost_price: 3100, as_of: "2026-01-02" });

    // The other workspace's product with the same SKU is untouched.
    expect((state.db.products as Row[]).find((p) => p.id === B)).toMatchObject({ cost_price: 111, cost_price_as_of: "2026-09-01", name: "Steel pipe DN300" });

    // Every write names the id AND the tenant.
    for (const c of writes().filter((w) => w.op === "update")) {
      expect(c.filters).toContainEqual(["tenant_id", "tenant-a"]);
      expect(c.filters.some(([k]) => k === "id")).toBe(true);
      expect(c.filters).not.toContainEqual(["id", B]);
    }
    expect(state.logs).toHaveLength(2);
    for (const l of state.logs) expect(l).toMatchObject({ tenantId: "tenant-a", objectType: "products", action: "update", actorId: "u1", actorEmail: "a@b.c" });
    const pipeLog = state.logs.find((l) => l.objectId === A)!;
    expect((pipeLog.changes as { field: string }[]).map((c) => c.field)).toEqual(expect.arrayContaining(["cost_price", "cost_price_as_of", "illustrative", "name"]));
  });

  it("a choice to add creates a product in this workspace with the next reference, and logs it", async () => {
    const decisions = JSON.stringify([{ row: 4, action: "add" }]);
    const view = await (await APPLY(req(csv(OK_CSV), { decisions }))).json();
    expect(view.summary).toMatchObject({ added: 1, updated: 2 });
    const added = (state.db.products as Row[]).find((p) => p.sku === "NEW-77")!;
    expect(added).toMatchObject({ tenant_id: "tenant-a", ref: "PRD-0007", name: "Stainless sink", cost_price: 900, cost_price_as_of: "2026-10-05", status: "active" });
    expect(state.logs.find((l) => l.action === "create")).toMatchObject({ tenantId: "tenant-a", objectType: "products", objectLabel: "Stainless sink" });
  });

  it("choices override the defaults: skipping a default update leaves that item alone", async () => {
    const decisions = JSON.stringify([{ row: 2, action: "skip" }]);
    const view = await (await APPLY(req(csv(OK_CSV), { decisions }))).json();
    expect(view.summary).toMatchObject({ updated: 1, skipped: 2 });
    expect((state.db.products as Row[]).find((p) => p.id === A)).toMatchObject({ cost_price: 340 });
  });

  it("a product id from ANOTHER workspace is refused on its row and nothing of that workspace is written", async () => {
    const decisions = JSON.stringify([{ row: 2, action: "update", product_id: B }, { row: 3, action: "skip" }, { row: 4, action: "skip" }]);
    const res = await APPLY(req(csv(OK_CSV), { decisions }));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.summary).toMatchObject({ updated: 0, errors: 1 });
    expect(view.notes[0]).toMatchObject({ row_no: 2, outcome: "error", message: "That item is not in this catalogue." });
    expect(writes()).toEqual([]);
    expect((state.db.products as Row[]).find((p) => p.id === B)).toMatchObject({ cost_price: 111 });
    expect(state.logs).toEqual([]);
  });

  it("refuses choices it cannot read before anything is written", async () => {
    for (const decisions of ["not json", JSON.stringify([{ row: 2, action: "delete" }]), JSON.stringify([{ row: 2, action: "update", product_id: "x'; drop table products;--" }]), JSON.stringify({ row: 2 })]) {
      const res = await APPLY(req(csv(OK_CSV), { decisions }));
      expect(res.status, decisions).toBe(400);
    }
    expect(writes()).toEqual([]);
  });

  it("never trusts a price sent back from the browser: only the file's rates are written", async () => {
    const decisions = JSON.stringify([{ row: 2, action: "update", product_id: A, rate: 1, cost_price: 1, as_of: "2020-01-01" }]);
    await APPLY(req(csv(OK_CSV), { decisions, rate: "1", cost_price: "1" }));
    expect((state.db.products as Row[]).find((p) => p.id === A)).toMatchObject({ cost_price: 355.5, cost_price_as_of: "2026-01-01" });
  });

  it("a row in another currency is not applied even when the person chose to update it", async () => {
    const sheet = "SKU,Item,Rate,Currency\nEST-PIPE-STEEL-300,Steel pipe DN300,400,USD\n";
    const decisions = JSON.stringify([{ row: 2, action: "update", product_id: A }]);
    const view = await (await APPLY(req(csv(sheet), { decisions }))).json();
    expect(view.summary).toMatchObject({ updated: 0, errors: 1 });
    expect(writes()).toEqual([]);
  });

  it("reads an Excel workbook, dates included", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Prices");
    ws.addRow(["Gulf Pipes price list"]);
    ws.addRow(["Item code", "Description", "UoM", "Unit Rate (SAR)", "Valid From"]);
    ws.addRow(["EST-VLV-300", "Isolation valve DN300", "nr", 3350, new Date(Date.UTC(2026, 9, 12))]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const file = new File([buf], "prices.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const view = await (await PREVIEW(req(file))).json();
    expect(view.sheet).toBe("Prices");
    expect(view.header_row).toBe(2);
    expect(view.rows[0]).toMatchObject({ sku: "EST-VLV-300", rate: 3350, as_of: "2026-10-12", status: "exact" });
    await APPLY(req(file));
    expect((state.db.products as Row[]).find((p) => p.id === A2)).toMatchObject({ cost_price: 3350, cost_price_as_of: "2026-10-12" });
  });
});

describe("the starter list", () => {
  it("is a CSV with a blank rate for each starter item this workspace has, and none for items it does not", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("SKU,Item name,Unit,Rate,Currency,Supplier,As of date");
    expect(lines.slice(1)).toEqual(["EST-PIPE-STEEL-300,Steel pipe DN300,m,,SAR,,", "EST-VLV-300,Isolation valve DN300 (gate or butterfly),nr,,SAR,,"]);
  });
});
