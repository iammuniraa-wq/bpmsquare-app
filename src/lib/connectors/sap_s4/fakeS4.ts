// A fake SAP S/4HANA OData V2 server for tests (like fakeDataverse.ts): it answers the services the connector
// reads (business partners and products; since SO4b also sales orders, outbound deliveries, billing documents and the order simulation), checks the login (Basic or APIKey), pages like SAP does (a server page size and a __next link), evaluates the
// small $filter language the connector writes, honours $select / $expand / $orderby / $top / $skip, and can be told
// to refuse a service (401, 403, 404) or to throttle once. Not a test file.

import { ORDER_METADATA } from "./metadataFixtures";

export type Row = Record<string, unknown>;

export type FakeS4Options = {
  host?: string;
  user?: string;
  password?: string;
  apiKey?: string;
  /** "" for the Communication-user host, "/s4hanacloud" for the sandbox. */
  prefix?: string;
  /** SAP caps a page below $top: the answer then carries __next. */
  serverPageSize?: number;
  /** A service the user may not reach: status the whole service answers with. */
  deny?: Partial<Record<"API_BUSINESS_PARTNER" | "API_PRODUCT_SRV" | OrderService, 401 | 403 | 404>>;
  /** Replace the $metadata of an order service (a release that lacks a property, or lists a writable marker). */
  metadata?: Partial<Record<OrderService, string>>;
  /** Writes need the CSRF token and cookie from a "Fetch" GET, as SAP does. Default true. */
  csrf?: boolean;
  /** What the order simulation answers: net price per material, stock per material (what ATP confirms), the credit result. */
  sim?: { prices?: Record<string, number>; stock?: Record<string, number>; confirmDate?: string; credit?: string; taxRate?: number; noSchedule?: boolean; fail?: { status: number; message: string } };
  /** How POST A_SalesOrder behaves. */
  create?: { fail?: { status: number; message: string }; timeoutAfterWrite?: boolean; timeoutWithoutWrite?: boolean; startNumber?: number };
  /** Answer 429 once on the first data call. */
  throttleOnce?: boolean;
  /** Make $metadata fail (too large / refused). */
  metadataFails?: boolean;
  /** The host the __next link names (a hostile server might name another). */
  nextHost?: string;
};

export type OrderService = "API_SALES_ORDER_SRV" | "API_OUTBOUND_DELIVERY_SRV" | "API_BILLING_DOCUMENT_SRV" | "API_SALES_ORDER_SIMULATION_SRV";
const ORDER_SERVICES: readonly string[] = ["API_SALES_ORDER_SRV", "API_OUTBOUND_DELIVERY_SRV", "API_BILLING_DOCUMENT_SRV", "API_SALES_ORDER_SIMULATION_SRV"];

const day = (iso: string) => `/Date(${Date.parse(`${iso}T00:00:00Z`)})/`;

export const BP_METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices><Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
<EntityType Name="A_BusinessPartnerType"><Key><PropertyRef Name="BusinessPartner"/></Key>
<Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>
<Property Name="Customer" Type="Edm.String" MaxLength="10"/>
<Property Name="Supplier" Type="Edm.String" MaxLength="10"/>
<Property Name="BusinessPartnerCategory" Type="Edm.String" MaxLength="1"/>
<Property Name="BusinessPartnerFullName" Type="Edm.String" MaxLength="81"/>
<Property Name="BusinessPartnerGrouping" Type="Edm.String" MaxLength="4"/>
<Property Name="Industry" Type="Edm.String" MaxLength="10"/>
<Property Name="OrganizationBPName1" Type="Edm.String" MaxLength="40"/>
<Property Name="LastChangeDate" Type="Edm.DateTime" Precision="0"/>
<Property Name="IsNaturalPerson" Type="Edm.String"/>
<Property Name="SomeCount" Type="Edm.Int32"/>
<NavigationProperty Name="to_BusinessPartnerAddress" Relationship="x" FromRole="a" ToRole="b"/>
</EntityType>
<EntityType Name="A_BusinessPartnerAddressType"><Key><PropertyRef Name="BusinessPartner"/><PropertyRef Name="AddressID"/></Key>
<Property Name="BusinessPartner" Type="Edm.String" Nullable="false"/><Property Name="AddressID" Type="Edm.String" Nullable="false"/>
<Property Name="CityName" Type="Edm.String"/><Property Name="StreetName" Type="Edm.String"/><Property Name="PostalCode" Type="Edm.String"/><Property Name="Country" Type="Edm.String"/>
</EntityType>
<EntityContainer Name="API_BUSINESS_PARTNER_Entities"><EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartnerType"/><EntitySet Name="A_BusinessPartnerAddress" EntityType="API_BUSINESS_PARTNER.A_BusinessPartnerAddressType"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>`;

export const PRODUCT_METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices><Schema Namespace="API_PRODUCT_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
<EntityType Name="A_ProductType"><Key><PropertyRef Name="Product"/></Key>
<Property Name="Product" Type="Edm.String" Nullable="false"/><Property Name="ProductType" Type="Edm.String"/><Property Name="ProductGroup" Type="Edm.String"/>
<Property Name="BaseUnit" Type="Edm.String"/><Property Name="IsMarkedForDeletion" Type="Edm.Boolean"/><Property Name="LastChangeDate" Type="Edm.DateTime"/>
</EntityType>
<EntityType Name="A_ProductDescriptionType"><Key><PropertyRef Name="Product"/><PropertyRef Name="Language"/></Key>
<Property Name="Product" Type="Edm.String" Nullable="false"/><Property Name="Language" Type="Edm.String" Nullable="false"/><Property Name="ProductDescription" Type="Edm.String"/>
</EntityType>
<EntityContainer Name="E"><EntitySet Name="A_Product" EntityType="API_PRODUCT_SRV.A_ProductType"/><EntitySet Name="A_ProductDescription" EntityType="API_PRODUCT_SRV.A_ProductDescriptionType"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>`;

export type FakeBp = { bp: string; name: string; customer?: string; supplier?: string; changed: string; category?: string; city?: string; email?: string; phone?: string; country?: string; street?: string; zip?: string };
export type FakeProduct = { product: string; description?: string; unit?: string; changed: string; deleted?: boolean; type?: string };

export const bpRow = (b: FakeBp): Row => ({
  __metadata: { type: "API_BUSINESS_PARTNER.A_BusinessPartnerType" },
  BusinessPartner: b.bp, Customer: b.customer ?? "", Supplier: b.supplier ?? "", BusinessPartnerCategory: b.category ?? "2", BusinessPartnerFullName: b.name,
  OrganizationBPName1: b.name, LastChangeDate: day(b.changed),
  to_BusinessPartnerAddress: {
    results: [{
      BusinessPartner: b.bp, AddressID: "1", CityName: b.city ?? "", StreetName: b.street ?? "", PostalCode: b.zip ?? "", Country: b.country ?? "",
      to_EmailAddress: { results: b.email ? [{ EmailAddress: b.email, IsDefaultEmailAddress: true }] : [] },
      to_PhoneNumber: { results: b.phone ? [{ PhoneNumber: b.phone, InternationalPhoneNumber: b.phone, IsDefaultPhoneNumber: true }] : [] },
    }],
  },
});

export const productRow = (p: FakeProduct): Row => ({
  __metadata: { type: "API_PRODUCT_SRV.A_ProductType" },
  Product: p.product, ProductType: p.type ?? "FERT", BaseUnit: p.unit ?? "PC", IsMarkedForDeletion: p.deleted === true, LastChangeDate: day(p.changed),
  to_Description: { results: p.description ? [{ Product: p.product, Language: "DE", ProductDescription: `${p.description} (de)` }, { Product: p.product, Language: "EN", ProductDescription: p.description }] : [] },
});

// ── $filter ────────────────────────────────────────────────────────────────

type Pred = (r: Row) => boolean;

function parseLiteral(tok: string): unknown {
  const dt = /^datetime'(\d{4}-\d{2}-\d{2})T[\d:]+'$/.exec(tok);
  if (dt) return Date.parse(`${dt[1]}T00:00:00Z`);
  const dto = /^datetimeoffset'(\d{4}-\d{2}-\d{2})T[\d:]+Z?'$/.exec(tok);
  if (dto) return Date.parse(`${dto[1]}T00:00:00Z`);
  if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'");
  if (tok === "true") return true;
  if (tok === "false") return false;
  return Number(tok);
}

function valueOf(v: unknown): unknown {
  if (typeof v === "string") {
    const m = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(v);
    if (m) return Number(m[1]);
  }
  return v ?? "";
}

/** The filters the connector writes: `(a) and (b)`, `x eq 'v' or y eq 'w'`, ne / ge / gt, literals incl. datetime'...'. */
export function evalFilter(expr: string | null | undefined): Pred {
  if (!expr) return () => true;
  let i = 0;
  const s = expr;
  const ws = () => { while (s[i] === " ") i++; };
  const word = (): string => {
    ws();
    if (s[i] === "'") { let j = i + 1; for (;;) { if (s[j] === "'" && s[j + 1] === "'") j += 2; else if (s[j] === "'") break; else j++; } const t = s.slice(i, j + 1); i = j + 1; return t; }
    if (s.startsWith("datetime'", i)) { const j = s.indexOf("'", i + 9); const t = s.slice(i, j + 1); i = j + 1; return t; }
    if (s.startsWith("datetimeoffset'", i)) { const j = s.indexOf("'", i + 15); const t = s.slice(i, j + 1); i = j + 1; return t; }
    let j = i; while (j < s.length && !" ()".includes(s[j])) j++;
    const t = s.slice(i, j); i = j; return t;
  };
  const primary = (): Pred => {
    ws();
    if (s[i] === "(") { i++; const p = or(); ws(); i++; return p; }
    const field = word(), op = word(), lit = parseLiteral(word());
    return (r) => {
      const v = valueOf(r[field]);
      switch (op) {
        case "eq": return v === lit;
        case "ne": return v !== lit;
        case "ge": return typeof v === "number" ? v >= (lit as number) : String(v) >= String(lit);
        case "gt": return typeof v === "number" ? v > (lit as number) : String(v) > String(lit);
        default: throw new Error(`fake S/4: operator ${op}`);
      }
    };
  };
  const and = (): Pred => { let p = primary(); for (;;) { ws(); if (s.startsWith("and ", i)) { i += 4; const q = primary(); const a = p; p = (r) => a(r) && q(r); } else return p; } };
  const or = (): Pred => { let p = and(); for (;;) { ws(); if (s.startsWith("or ", i)) { i += 3; const q = and(); const a = p; p = (r) => a(r) || q(r); } else return p; } };
  return or();
}

// ── The server ─────────────────────────────────────────────────────────────

export class FakeS4 {
  bps: Row[] = [];
  products: Row[] = [];
  orders: Row[] = [];
  deliveryHeaders: Row[] = [];
  deliveryItems: Row[] = [];
  billingHeaders: Row[] = [];
  billingItems: Row[] = [];
  /** Every body POSTed to A_SalesOrder, in order (what was sent, not what was stored). */
  created: Record<string, unknown>[] = [];
  /** Every body POSTed to A_SalesOrderSimulation. */
  simulated: Record<string, unknown>[] = [];
  /** How many times a CSRF token was handed out. */
  csrfFetches = 0;
  calls: { url: URL; headers: Headers; method: string; body: unknown }[] = [];
  private throttled = false;
  private nextOrder: number;
  private token = "";
  readonly opts: Required<Pick<FakeS4Options, "host" | "prefix">> & FakeS4Options;

  constructor(opts: FakeS4Options = {}) {
    this.opts = { host: "my426318-api.s4hana.cloud.sap", prefix: "", ...opts };
    this.nextOrder = opts.create?.startNumber ?? 100;
  }

  addOrders(...o: FakeOrder[]) { this.orders.push(...o.map(orderRow)); return this; }
  /** A delivery for an order: header plus one item that references the order (A_OutbDeliveryItem.ReferenceSDDocument). */
  addDelivery(d: { number: string; order: string; issued?: string; planned?: string; movement?: string }) {
    this.deliveryHeaders.push({
      __metadata: { type: "API_OUTBOUND_DELIVERY_SRV.A_OutbDeliveryHeaderType" }, DeliveryDocument: d.number, CreationDate: day("2026-10-02"), DeliveryDate: d.planned ? day(d.planned) : null,
      ActualGoodsMovementDate: d.issued ? day(d.issued) : null, OverallGoodsMovementStatus: d.movement ?? (d.issued ? "C" : "A"),
    });
    this.deliveryItems.push({ DeliveryDocument: d.number, DeliveryDocumentItem: "10", ReferenceSDDocument: d.order, ReferenceSDDocumentItem: "10" });
    return this;
  }
  /** A billing document for an order (BillingDocumentItem.SalesDocument = the order). */
  addBilling(b: { number: string; order: string; net: number; tax?: number; clearing?: string; cancelled?: boolean; date?: string; viaDelivery?: string }) {
    this.billingHeaders.push({
      __metadata: { type: "API_BILLING_DOCUMENT_SRV.A_BillingDocumentType" }, BillingDocument: b.number, BillingDocumentDate: day(b.date ?? "2026-10-20"), CreationDate: day(b.date ?? "2026-10-20"),
      TotalNetAmount: String(b.net), TaxAmount: String(b.tax ?? 0), TransactionCurrency: "EUR", BillingDocumentIsCancelled: b.cancelled === true, InvoiceClearingStatus: b.clearing ?? "A",
    });
    this.billingItems.push({ BillingDocument: b.number, BillingDocumentItem: "10", SalesDocument: b.viaDelivery ? "" : b.order, ReferenceSDDocument: b.viaDelivery ?? "" });
    return this;
  }

  addBps(...b: FakeBp[]) { this.bps.push(...b.map(bpRow)); return this; }
  addProducts(...p: FakeProduct[]) { this.products.push(...p.map(productRow)); return this; }

  private authOk(h: Headers): boolean {
    if (this.opts.apiKey !== undefined) return h.get("apikey") === this.opts.apiKey;
    const a = h.get("authorization") ?? "";
    return a === `Basic ${Buffer.from(`${this.opts.user ?? ""}:${this.opts.password ?? ""}`).toString("base64")}`;
  }

  /** The `fetch` to hand the connector (or stub globally). */
  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init.headers);
    this.calls.push({ url, headers, method: (init.method ?? "GET").toUpperCase(), body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.host !== this.opts.host) return new Response("wrong host", { status: 502 });
    const m = new RegExp(`^${this.opts.prefix}/sap/opu/odata/sap/(API_BUSINESS_PARTNER|API_PRODUCT_SRV|API_SALES_ORDER_SRV|API_OUTBOUND_DELIVERY_SRV|API_BILLING_DOCUMENT_SRV|API_SALES_ORDER_SIMULATION_SRV)/(.*)$`).exec(url.pathname);
    if (!m) return json(404, { error: { message: { value: "Resource not found" } } });
    const service = m[1] as keyof NonNullable<FakeS4Options["deny"]>;
    const path = decodeURIComponent(m[2]);
    if (!this.authOk(headers)) return json(401, { error: { message: { value: "Unauthorized" } } });
    const denied = this.opts.deny?.[service];
    if (denied) return json(denied, { error: { message: { value: `denied ${denied}` } } });
    const method = (init.method ?? "GET").toUpperCase();
    const isOrderService = ORDER_SERVICES.includes(service);
    if (path === "$metadata") {
      if (this.opts.metadataFails) return new Response("too large", { status: 500 });
      const xml = isOrderService ? this.opts.metadata?.[service as OrderService] ?? ORDER_METADATA[service] : service === "API_BUSINESS_PARTNER" ? BP_METADATA : PRODUCT_METADATA;
      return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
    }
    // The service root hands out the CSRF token and its cookies.
    if (path === "" && method === "GET") {
      if (headers.get("x-csrf-token") !== "Fetch") return json(200, { d: { EntitySets: [] } });
      this.token = `tok-${++this.csrfFetches}`;
      const h = new Headers({ "content-type": "application/json", "x-csrf-token": this.token });
      h.append("set-cookie", `sap-XSRF_S4=${this.token}; path=/; secure`);
      h.append("set-cookie", "SAP_SESSIONID_S4=abc123; path=/; HttpOnly");
      return new Response(JSON.stringify({ d: { EntitySets: [] } }), { status: 200, headers: h });
    }
    if (method === "POST") return this.post(service, path, headers, init.body ? JSON.parse(String(init.body)) : {}, json);
    if (this.opts.throttleOnce && !this.throttled) { this.throttled = true; return new Response("slow down", { status: 429, headers: { "retry-after": "0" } }); }

    const key = /^([A-Za-z_]+)\('([^']*)'\)$/.exec(path);
    const setName = key ? key[1] : path;
    const set = this.setFor(service, setName);
    if (!set) return json(404, { error: { message: { value: "Resource not found for the segment" } } });

    const q = url.searchParams;
    let rows: Row[];
    try { rows = set.filter(evalFilter(q.get("$filter"))); } catch (e) { return json(400, { error: { message: { value: (e as Error).message } } }); }
    if (key) {
      const idCol = ({ A_SalesOrder: "SalesOrder", A_OutbDeliveryHeader: "DeliveryDocument", A_BillingDocument: "BillingDocument" } as Record<string, string>)[setName] ?? "";
      rows = rows.filter((r) => String(r[idCol]) === key[2]);
      if (rows.length === 0) return json(404, { error: { message: { value: "Resource not found for the segment" } } });
    }
    const orderby = q.get("$orderby");
    if (orderby) {
      const col = orderby.split(/[ ,]/)[0];
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0));
    }
    const skip = Number(q.get("$skip") ?? 0) || 0;
    const top = q.has("$top") ? Number(q.get("$top")) : rows.length;
    const cap = this.opts.serverPageSize ?? Infinity;
    const take = Math.min(top, cap);
    const page = rows.slice(skip, skip + take);
    const hasMore = skip + take < rows.length && take < top;
    const select = q.get("$select")?.split(",");
    const expand = q.get("$expand") ? q.get("$expand")!.split(",") : [];
    // Order services follow the OData rule that a nested expansion must be asked for by its path; the master-data ones keep their whole nested value.
    const strict = isOrderService;
    const shape = (r: Row, paths: string[], top: boolean): Row => {
      const out: Row = { __metadata: r.__metadata };
      for (const [k, v] of Object.entries(r)) {
        if (k === "__metadata") continue;
        if (k.startsWith("to_")) {
          const hit = paths.filter((p) => p === k || p.startsWith(`${k}/`));
          if (hit.length === 0 || (top && select && !select.includes(k))) continue;
          const nested = hit.filter((p) => p.startsWith(`${k}/`)).map((p) => p.slice(k.length + 1));
          const results = (v as { results?: Row[] } | null)?.results;
          out[k] = strict && Array.isArray(results) ? { results: results.map((c) => shape(c, nested, false)) } : v;
          continue;
        }
        if (!top || !select || select.includes(k)) out[k] = v;
      }
      return out;
    };
    if (key) return json(200, { d: shape(page[0], expand, true) });
    let next: string | undefined;
    if (hasMore) {
      const n = new URL(url);
      n.host = this.opts.nextHost ?? n.host;
      n.searchParams.set("$skiptoken", String(skip + take));
      n.searchParams.set("$skip", String(skip + take));
      next = n.toString();
    }
    return json(200, { d: { results: page.map((r) => shape(r, expand, true)), ...(next ? { __next: next } : {}) } });
  };

  private setFor(service: string, name: string): Row[] | null {
    const map: Record<string, Record<string, Row[]>> = {
      API_BUSINESS_PARTNER: { A_BusinessPartner: this.bps },
      API_PRODUCT_SRV: { A_Product: this.products },
      API_SALES_ORDER_SRV: { A_SalesOrder: this.orders },
      API_OUTBOUND_DELIVERY_SRV: { A_OutbDeliveryHeader: this.deliveryHeaders, A_OutbDeliveryItem: this.deliveryItems },
      API_BILLING_DOCUMENT_SRV: { A_BillingDocument: this.billingHeaders, A_BillingDocumentItem: this.billingItems },
    };
    return map[service]?.[name] ?? null;
  }

  /** POST A_SalesOrder and POST A_SalesOrderSimulation. */
  private post(service: string, path: string, headers: Headers, body: Record<string, unknown>, json: (status: number, body: unknown) => Response): Response | Promise<Response> {
    if (this.opts.csrf !== false) {
      const cookie = headers.get("cookie") ?? "";
      if (!this.token || headers.get("x-csrf-token") !== this.token || !cookie.includes(`sap-XSRF_S4=${this.token}`) || !cookie.includes("SAP_SESSIONID_S4=abc123")) {
        return new Response(JSON.stringify({ error: { message: { value: "CSRF token validation failed" } } }), { status: 403, headers: { "content-type": "application/json", "x-csrf-token": "Required" } });
      }
    }
    const items = (b: Record<string, unknown>): Row[] => {
      const t = b.to_Item as unknown;
      return (Array.isArray(t) ? t : (t as { results?: Row[] } | undefined)?.results ?? []) as Row[];
    };
    const sim = this.opts.sim ?? {};
    const priceOf = (material: string) => sim.prices?.[material] ?? 10;
    const confirmedOf = (material: string, qty: number) => Math.min(qty, sim.stock?.[material] ?? qty);
    const itemRow = (i: Row, no: string, withSchedule: boolean): Row => {
      const qty = Number(i.RequestedQuantity ?? 0);
      const material = String(i.Material ?? "");
      const net = Math.round(priceOf(material) * qty * 100) / 100;
      const conf = confirmedOf(material, qty);
      return {
        SalesOrderItem: String(i.SalesOrderItem ?? no), Material: material, RequestedQuantity: String(qty), RequestedQuantityUnit: "PC", NetAmount: String(net),
        TaxAmount: String(Math.round(net * (sim.taxRate ?? 0) * 100) / 100), SDProcessStatus: "A", DeliveryStatus: "A", OrderRelatedBillingStatus: "",
        ...(withSchedule && !sim.noSchedule ? { to_ScheduleLine: { results: [{ ScheduleLine: "0001", RequestedDeliveryDate: null, ConfirmedDeliveryDate: day(sim.confirmDate ?? "2026-11-05"), ConfdOrderQtyByMatlAvailCheck: String(conf), ScheduleLineOrderQuantity: String(qty) }] } } : {}),
      };
    };

    if (service === "API_SALES_ORDER_SIMULATION_SRV" && path === "A_SalesOrderSimulation") {
      this.simulated.push(body);
      if (sim.fail) return json(sim.fail.status, { error: { message: { value: sim.fail.message } } });
      const rows = items(body).map((i, idx) => itemRow(i, String((idx + 1) * 10), true));
      const net = rows.reduce((s, r) => s + Number(r.NetAmount), 0);
      return json(201, { d: {
        SalesOrder: "", SalesOrderType: body.SalesOrderType, SoldToParty: body.SoldToParty, TransactionCurrency: body.TransactionCurrency ?? "EUR",
        to_Item: { results: rows },
        to_Pricing: { results: [{ SalesOrder: "", TotalNetAmount: String(Math.round(net * 100) / 100), TransactionCurrency: body.TransactionCurrency ?? "EUR" }] },
        ...(sim.credit !== undefined ? { to_Credit: { results: [{ SalesOrder: "", TotalCreditCheckStatus: sim.credit }] } } : {}),
      } });
    }

    if (service === "API_SALES_ORDER_SRV" && path === "A_SalesOrder") {
      this.created.push(body);
      const c = this.opts.create ?? {};
      if (c.timeoutWithoutWrite) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (c.fail) return json(c.fail.status, { error: { message: { value: c.fail.message } } });
      for (const need of ["SalesOrderType", "SalesOrganization", "DistributionChannel", "OrganizationDivision", "SoldToParty"]) {
        if (!body[need]) return json(400, { error: { message: { value: `Field ${need} is required` } } });
      }
      const its = items(body);
      if (its.length === 0 || its.some((i) => !i.Material)) return json(400, { error: { message: { value: "Material is required for every item" } } });
      const number = String(this.nextOrder++).padStart(10, "0");
      const rows: Row[] = its.map((i, idx) => ({ SalesOrder: number, ...itemRow(i, String((idx + 1) * 10), true) }));
      const net = rows.reduce((s, r) => s + Number(r.NetAmount), 0);
      const row: Row = {
        __metadata: { type: "API_SALES_ORDER_SRV.A_SalesOrderType" }, SalesOrder: number, CreationDate: day("2026-10-24"), LastChangeDateTime: `/Date(${Date.parse("2026-10-24T09:00:00Z")}+0000)/`,
        SalesOrderType: body.SalesOrderType, SalesOrganization: body.SalesOrganization, DistributionChannel: body.DistributionChannel, OrganizationDivision: body.OrganizationDivision,
        SoldToParty: body.SoldToParty, PurchaseOrderByCustomer: body.PurchaseOrderByCustomer ?? "", TransactionCurrency: body.TransactionCurrency ?? "EUR",
        TotalNetAmount: String(Math.round(net * 100) / 100), RequestedDeliveryDate: null, OverallSDProcessStatus: "A", OverallTotalDeliveryStatus: "A", OverallSDDocumentRejectionSts: "A", TotalCreditCheckStatus: "",
        ...(body.AccountingDocExternalReference !== undefined ? { AccountingDocExternalReference: body.AccountingDocExternalReference } : {}),
        to_Item: { results: rows },
      };
      this.orders.push(row);
      if (c.timeoutAfterWrite) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return json(201, { d: row });
    }
    return json(404, { error: { message: { value: "Resource not found for the segment" } } });
  };
}

// ── Orders ──────────────────────────────────────────────────────────────────

export type FakeOrder = {
  number: string; soldTo: string; changed: string; created?: string; requested?: string; net?: number; currency?: string; process?: string; delivery?: string; billing?: string;
  rejection?: string; po?: string; ref?: string;
  items?: { item: string; material: string; qty: number; net: number; text?: string; tax?: number; confirmed?: { qty: number; date: string }; billing?: string }[];
};

export const orderRow = (o: FakeOrder): Row => {
  const items = o.items ?? [{ item: "10", material: "TG11", qty: 2, net: 20 }];
  return {
    __metadata: { type: "API_SALES_ORDER_SRV.A_SalesOrderType" }, SalesOrder: o.number, CreationDate: day(o.created ?? o.changed), LastChangeDate: null,
    LastChangeDateTime: `/Date(${Date.parse(`${o.changed}T08:00:00Z`)}+0000)/`, PurchaseOrderByCustomer: o.po ?? "", SalesOrderType: "OR",
    TotalNetAmount: String(o.net ?? items.reduce((s, i) => s + i.net, 0)), TransactionCurrency: o.currency ?? "EUR", RequestedDeliveryDate: o.requested ? day(o.requested) : null,
    OverallSDProcessStatus: o.process ?? "A", TotalCreditCheckStatus: "", OverallTotalDeliveryStatus: o.delivery ?? "A", OverallSDDocumentRejectionSts: o.rejection ?? "A",
    SoldToParty: o.soldTo, SalesOrganization: "1010", DistributionChannel: "10", OrganizationDivision: "00",
    ...(o.ref !== undefined ? { AccountingDocExternalReference: o.ref } : {}),
    to_Item: { results: items.map((i) => ({
      SalesOrder: o.number, SalesOrderItem: i.item, Material: i.material, RequestedQuantity: String(i.qty), RequestedQuantityUnit: "PC", NetAmount: String(i.net),
      SalesOrderItemText: i.text ?? `Item ${i.material}`, TaxAmount: String(i.tax ?? 0), SDProcessStatus: "A", DeliveryStatus: "A", OrderRelatedBillingStatus: i.billing ?? "",
      to_ScheduleLine: { results: i.confirmed ? [{ ScheduleLine: "0001", RequestedDeliveryDate: o.requested ? day(o.requested) : null, ConfirmedDeliveryDate: day(i.confirmed.date), ConfdOrderQtyByMatlAvailCheck: String(i.confirmed.qty) }] : [] },
    })) },
  };
};
