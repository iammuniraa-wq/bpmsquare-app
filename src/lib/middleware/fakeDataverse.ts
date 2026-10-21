import { D365Error } from "@/lib/connectors/d365/odata";
import type { ErpHttp } from "./erp";

// An in-memory Dataverse that enforces the rules verified against the live
// trial (2026-10-21): a quote needs a name and customer, price list and
// currency binds; a write-in line must not carry a uomid; a new quote is a
// Draft; WinQuote / CloseQuote only work on an Active quote. Used by the
// middleware tests. Not a test file.

export type FakeQuote = {
  quoteid: string;
  quotenumber: string;
  name: string;
  statecode: number;
  statuscode: number;
  totalamount: number;
  body: Record<string, unknown>;
  lines: Record<string, unknown>[];
};

export type FakeOrder = {
  salesorderid: string;
  ordernumber: string;
  name: string;
  statecode: number;
  statuscode: number;
  totalamount: number;
  body: Record<string, unknown>;
  lines: Record<string, unknown>[];
};

export type Call = { method: string; path: string; body?: unknown; query?: Record<string, string | undefined> };

export class FakeDataverse implements ErpHttp {
  quotes: FakeQuote[] = [];
  orders: FakeOrder[] = [];
  calls: Call[] = [];
  /** Throw this once when the named step is reached. */
  failOnce: Partial<Record<"create" | "createOrder" | "activate" | "WinQuote" | "CloseQuote" | "get", { status: number; message: string }>> = {};
  /** Wait this long (ms) inside every create, so two dispatches overlap the way they do on a real network. */
  createDelayMs = 0;
  /** Dynamics account id -> its own price list (null = the account has none). An account not listed here is "not found". */
  accountPriceLists: Record<string, string | null> = {};
  /** Extra read-only data: entity set -> rows, for list calls. */
  data: Record<string, Record<string, unknown>[]> = {};
  private n = 0;

  private hit(step: keyof FakeDataverse["failOnce"]) {
    const f = this.failOnce[step];
    if (f) {
      delete this.failOnce[step];
      throw new D365Error(f.message, f.status);
    }
  }

  async get(pathOrUrl: string, query?: Record<string, string | undefined>): Promise<unknown> {
    this.calls.push({ method: "GET", path: pathOrUrl, query });
    this.hit("get");
    const one = /^quotes\(([^)]+)\)$/.exec(pathOrUrl);
    if (one) {
      const q = this.quotes.find((x) => x.quoteid === one[1]);
      if (!q) throw new D365Error("quote does not exist", 404);
      return this.view(q);
    }
    const oneOrder = /^salesorders\(([^)]+)\)$/.exec(pathOrUrl);
    if (oneOrder) {
      const o = this.orders.find((x) => x.salesorderid === oneOrder[1]);
      if (!o) throw new D365Error("salesorder does not exist", 404);
      return this.orderView(o);
    }
    if (pathOrUrl === "salesorders") {
      const m = /startswith\(name,'(.*)'\)/.exec(query?.$filter ?? "");
      const prefix = m ? m[1].replace(/''/g, "'") : "";
      return { value: this.orders.filter((o) => o.name.startsWith(prefix)).slice(0, Number(query?.$top ?? 50)).map((o) => this.orderView(o)) };
    }
    if (pathOrUrl === "quotes") {
      const m = /startswith\(name,'(.*)'\)/.exec(query?.$filter ?? "");
      const prefix = m ? m[1].replace(/''/g, "'") : "";
      return { value: this.quotes.filter((q) => q.name.startsWith(prefix)).slice(0, Number(query?.$top ?? 50)).map((q) => this.view(q)) };
    }
    const acct = /^accounts\(([^)]+)\)$/.exec(pathOrUrl);
    if (acct && acct[1] in this.accountPriceLists) return { _defaultpricelevelid_value: this.accountPriceLists[acct[1]] };
    if (this.data[pathOrUrl]) return { value: this.data[pathOrUrl] };
    throw new D365Error(`unknown path ${pathOrUrl}`, 404);
  }

  private orderView(o: FakeOrder) {
    return {
      salesorderid: o.salesorderid, ordernumber: o.ordernumber, name: o.name, statecode: o.statecode, statuscode: o.statuscode, totalamount: o.totalamount,
      description: typeof o.body.description === "string" ? o.body.description : null,
    };
  }

  private view(q: FakeQuote) {
    return {
      quoteid: q.quoteid, quotenumber: q.quotenumber, name: q.name, statecode: q.statecode, statuscode: q.statuscode, totalamount: q.totalamount,
      description: typeof q.body.description === "string" ? q.body.description : null,
    };
  }

  async create(entitySet: string, body: Record<string, unknown>) {
    this.calls.push({ method: "POST", path: entitySet, body });
    if (this.createDelayMs) await new Promise((r) => setTimeout(r, this.createDelayMs));
    if (entitySet === "salesorders") {
      this.hit("createOrder");
      if (!body.name) throw new D365Error("name is required", 400);
      if (!body["customerid_account@odata.bind"]) throw new D365Error("customerid is required", 400);
      if (!body["pricelevelid@odata.bind"]) throw new D365Error("The price list is required", 400);
      if (!body["transactioncurrencyid@odata.bind"]) throw new D365Error("transactioncurrencyid is required", 400);
      const lines = (body.order_details as Record<string, unknown>[] | undefined) ?? [];
      for (const l of lines) {
        if ("uomid@odata.bind" in l || "uomid" in l) throw new D365Error("Cannot set both a product and a write-in: uomid", 400);
        if (l.isproductoverridden !== true || typeof l.productdescription !== "string") throw new D365Error("A write-in line needs productdescription and isproductoverridden", 400);
      }
      const id = `00000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`;
      const total = lines.reduce((sum, l) => sum + Number(l.quantity ?? 0) * Number(l.priceperunit ?? 0), 0);
      // Born Active: statecode 0 / statuscode 1 (verified live).
      const o: FakeOrder = { salesorderid: id, ordernumber: `ORD-${String(1000 + this.n).padStart(5, "0")}-TEST`, name: String(body.name), statecode: 0, statuscode: 1, totalamount: Math.round(total * 100) / 100, body, lines };
      this.orders.push(o);
      return { row: this.orderView(o), entityId: id, status: 201 };
    }
    if (entitySet !== "quotes") {
      this.data[entitySet] ??= [];
      const row = { id: `rec-${++this.n}`, ...body };
      this.data[entitySet].push(row);
      return { row, entityId: row.id };
    }
    this.hit("create");
    if (!body.name) throw new D365Error("name is required", 400);
    if (!body["customerid_account@odata.bind"]) throw new D365Error("customerid is required", 400);
    if (!body["pricelevelid@odata.bind"]) throw new D365Error("The price list is required", 400);
    if (!body["transactioncurrencyid@odata.bind"]) throw new D365Error("transactioncurrencyid is required", 400);
    const lines = (body.quote_details as Record<string, unknown>[] | undefined) ?? [];
    for (const l of lines) {
      if ("uomid@odata.bind" in l || "uomid" in l) throw new D365Error("Cannot set both a product and a write-in: uomid", 400);
      if (l.isproductoverridden !== true || typeof l.productdescription !== "string") throw new D365Error("A write-in line needs productdescription and isproductoverridden", 400);
    }
    const id = `00000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`;
    const total = lines.reduce((s, l) => s + Number(l.quantity ?? 0) * Number(l.priceperunit ?? 0), 0);
    const q: FakeQuote = {
      quoteid: id, quotenumber: `QUO-${String(1000 + this.n).padStart(5, "0")}-TEST`, name: String(body.name),
      statecode: 0, statuscode: 1, totalamount: Math.round(total * 100) / 100, body, lines,
    };
    this.quotes.push(q);
    const row = { ...this.view(q), name: q.name };
    return { row, entityId: id };
  }

  async requestRaw(method: string, pathOrUrl: string, init: { body?: unknown; query?: Record<string, string | undefined> } = {}) {
    this.calls.push({ method, path: pathOrUrl, body: init.body, query: init.query });
    const headers = new Headers();
    const patch = /^quotes\(([^)]+)\)$/.exec(pathOrUrl);
    if (method === "PATCH" && patch) {
      this.hit("activate");
      const q = this.quotes.find((x) => x.quoteid === patch[1]);
      if (!q) throw new D365Error("quote does not exist", 404);
      const b = init.body as { statecode?: number; statuscode?: number };
      if (b.statecode === 1 && q.statecode === 0) { q.statecode = 1; q.statuscode = b.statuscode ?? 2; }
      else throw new D365Error("The quote cannot move to that state", 400);
      return { json: null, headers, status: 204 };
    }
    if (method === "POST" && (pathOrUrl === "WinQuote" || pathOrUrl === "CloseQuote")) {
      this.hit(pathOrUrl);
      const b = init.body as { QuoteClose?: Record<string, unknown>; Status?: number };
      const bind = String(b.QuoteClose?.["quoteid@odata.bind"] ?? "");
      const m = /^\/quotes\(([^)]+)\)$/.exec(bind);
      const q = m ? this.quotes.find((x) => x.quoteid === m[1]) : undefined;
      if (!q) throw new D365Error("quote does not exist", 404);
      if (!b.QuoteClose?.subject) throw new D365Error("QuoteClose subject is required", 400);
      if (q.statecode !== 1) throw new D365Error("Only an active quote can be closed", 400);
      if (pathOrUrl === "WinQuote" && b.Status === 4) { q.statecode = 2; q.statuscode = 4; }
      else if (pathOrUrl === "CloseQuote" && b.Status === 5) { q.statecode = 3; q.statuscode = 5; }
      else throw new D365Error("Wrong status for this action", 400);
      return { json: null, headers, status: 204 };
    }
    throw new D365Error(`unexpected ${method} ${pathOrUrl}`, 400);
  }
}
