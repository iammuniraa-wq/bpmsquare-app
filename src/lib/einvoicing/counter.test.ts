import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALLOCATE_FN, allocateEinvoiceSeq, type SeqClient } from "./counter";

// An in-memory model of allocate_einvoice_seq (migration 0219): the same contract, so the wrapper is exercised against
// concurrent callers, repeats and failures. Calls are serialised exactly the way the database serialises them (the counter
// row is locked until the transaction ends).
function fakeDb(opts: { failAfterTake?: Set<string> } = {}) {
  const counters = new Map<string, number>();
  const invoices = new Map<string, { tenant: string; seq: number | null; unit: string | null }>();
  let chain: Promise<unknown> = Promise.resolve();
  const calls: Record<string, unknown>[] = [];

  const body = (a: { p_tenant: string; p_invoice: string; p_seller_key: string }) => {
    const inv = invoices.get(a.p_invoice);
    if (!inv || inv.tenant !== a.p_tenant) return { data: null, error: { code: "P0002", message: "invoice not found" } };
    if (inv.seq != null) return { data: inv.seq, error: null };
    const key = `${a.p_tenant}|${a.p_seller_key ?? ""}`;
    const before = counters.get(key);
    const next = (before ?? 0) + 1;
    counters.set(key, next);
    if (opts.failAfterTake?.has(a.p_invoice)) {
      // the transaction rolls back: the counter goes back with it
      if (before === undefined) counters.delete(key); else counters.set(key, before);
      return { data: null, error: { code: "XX000", message: "boom" } };
    }
    inv.seq = next;
    inv.unit = a.p_seller_key ?? "";
    return { data: next, error: null };
  };

  const client: SeqClient = {
    rpc: (fn, args) => {
      calls.push({ fn, ...args });
      const run = chain.then(() => new Promise((r) => setTimeout(r, Math.random() * 3))).then(() => body(args as never));
      chain = run.catch(() => undefined);
      return run as never;
    },
  };
  return { client, counters, invoices, calls };
}

const alloc = (c: SeqClient, tenantId: string, invoiceId: string, sellerKey = "e1") => allocateEinvoiceSeq(c, { tenantId, invoiceId, sellerKey });

describe("allocateEinvoiceSeq", () => {
  it("calls the database function with the tenant, invoice and seller unit", async () => {
    const db = fakeDb();
    db.invoices.set("i1", { tenant: "t1", seq: null, unit: null });
    await alloc(db.client, "t1", "i1", "unit-a");
    expect(db.calls[0]).toEqual({ fn: ALLOCATE_FN, p_tenant: "t1", p_invoice: "i1", p_seller_key: "unit-a" });
  });

  it("50 concurrent allocations for one seller unit get 1..50 with no duplicate and no gap", async () => {
    const db = fakeDb();
    const ids = Array.from({ length: 50 }, (_, i) => `i${i}`);
    for (const id of ids) db.invoices.set(id, { tenant: "t1", seq: null, unit: null });
    const results = await Promise.all(ids.map((id) => alloc(db.client, "t1", id)));
    const seqs = results.map((r) => (r.ok ? r.seq : -1)).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(db.counters.get("t1|e1")).toBe(50);
  });

  it("each seller unit has its own sequence, and tenants never share one", async () => {
    const db = fakeDb();
    for (const [id, tenant] of [["a1", "t1"], ["a2", "t1"], ["b1", "t1"], ["c1", "t2"]] as const) db.invoices.set(id, { tenant, seq: null, unit: null });
    const r = await Promise.all([alloc(db.client, "t1", "a1", "A"), alloc(db.client, "t1", "a2", "A"), alloc(db.client, "t1", "b1", "B"), alloc(db.client, "t2", "c1", "A")]);
    expect(r.map((x) => (x.ok ? x.seq : 0))).toEqual([1, 2, 1, 1]);
  });

  it("asking again for an invoice that has its number returns that number and takes no new one", async () => {
    const db = fakeDb();
    db.invoices.set("i1", { tenant: "t1", seq: null, unit: null });
    db.invoices.set("i2", { tenant: "t1", seq: null, unit: null });
    const first = await alloc(db.client, "t1", "i1");
    const again = await Promise.all([alloc(db.client, "t1", "i1"), alloc(db.client, "t1", "i1")]);
    expect(first).toEqual({ ok: true, seq: 1 });
    expect(again).toEqual([{ ok: true, seq: 1 }, { ok: true, seq: 1 }]);
    expect(await alloc(db.client, "t1", "i2")).toEqual({ ok: true, seq: 2 });
  });

  it("a failure after the number is taken rolls the counter back: the next invoice gets the same number, no gap", async () => {
    const db = fakeDb({ failAfterTake: new Set(["bad"]) });
    for (const id of ["i1", "bad", "i3"]) db.invoices.set(id, { tenant: "t1", seq: null, unit: null });
    expect(await alloc(db.client, "t1", "i1")).toEqual({ ok: true, seq: 1 });
    const failed = await alloc(db.client, "t1", "bad");
    expect(failed).toMatchObject({ ok: false, reason: "error" });
    expect(db.invoices.get("bad")!.seq).toBeNull();
    expect(await alloc(db.client, "t1", "i3")).toEqual({ ok: true, seq: 2 });
  });

  it("another tenant's invoice id finds nothing", async () => {
    const db = fakeDb();
    db.invoices.set("theirs", { tenant: "t2", seq: null, unit: null });
    expect(await alloc(db.client, "t1", "theirs")).toMatchObject({ ok: false, reason: "not_found" });
    expect(db.counters.size).toBe(0);
  });

  it("a database without migration 0219 answers 'needs a database update', not an error", async () => {
    for (const code of ["42883", "PGRST202"]) {
      const client: SeqClient = { rpc: async () => ({ data: null, error: { code, message: "function allocate_einvoice_seq does not exist" } }) };
      const r = await alloc(client, "t1", "i1");
      expect(r).toMatchObject({ ok: false, reason: "pending" });
      expect(r.ok ? "" : r.message).toMatch(/database update/i);
    }
  });

  it("a non-number answer is refused", async () => {
    const client: SeqClient = { rpc: async () => ({ data: "x", error: null }) };
    expect(await alloc(client, "t1", "i1")).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("the SQL function really is an atomic upsert (never read-then-write)", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/0219_einvoicing_data.sql"), "utf8").replace(/--[^\n]*/g, "");
  const fn = sql.slice(sql.indexOf("create or replace function allocate_einvoice_seq"), sql.indexOf("revoke all on function allocate_einvoice_seq"));

  it("takes the number with one insert ... on conflict do update ... returning", () => {
    expect(fn).toMatch(/insert into einvoice_counters[\s\S]*on conflict \(tenant_id, seller_key\)[\s\S]*do update set last_seq = einvoice_counters\.last_seq \+ 1[\s\S]*returning last_seq into/i);
  });
  it("never reads the highest number to add one", () => {
    expect(fn).not.toMatch(/max\s*\(/i);
    expect(fn).not.toMatch(/select\s+last_seq/i);
    expect(fn).not.toMatch(/select[^;]*from einvoice_counters/i);
  });
  it("locks the invoice row and writes the number onto it in the same function", () => {
    expect(fn).toMatch(/from invoices where id = p_invoice and tenant_id = p_tenant\s+for update/i);
    expect(fn).toMatch(/update invoices set einvoice_seq = v_next/i);
  });
  it("returns the existing number when there is one", () => {
    expect(fn).toMatch(/if v_existing is not null then\s+return v_existing/i);
  });
});
