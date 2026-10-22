// A fake SAP S/4HANA OData V2 server for tests (like fakeDataverse.ts): it answers the two services the connector
// reads, checks the login (Basic or APIKey), pages like SAP does (a server page size and a __next link), evaluates the
// small $filter language the connector writes, honours $select / $expand / $orderby / $top / $skip, and can be told
// to refuse a service (401, 403, 404) or to throttle once. Not a test file.

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
  deny?: Partial<Record<"API_BUSINESS_PARTNER" | "API_PRODUCT_SRV", 401 | 403 | 404>>;
  /** Answer 429 once on the first data call. */
  throttleOnce?: boolean;
  /** Make $metadata fail (too large / refused). */
  metadataFails?: boolean;
  /** The host the __next link names (a hostile server might name another). */
  nextHost?: string;
};

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
  if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'");
  if (tok === "true") return true;
  if (tok === "false") return false;
  return Number(tok);
}

function valueOf(v: unknown): unknown {
  if (typeof v === "string") {
    const m = /^\/Date\((-?\d+)\)\/$/.exec(v);
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
  calls: { url: URL; headers: Headers }[] = [];
  private throttled = false;
  readonly opts: Required<Pick<FakeS4Options, "host" | "prefix">> & FakeS4Options;

  constructor(opts: FakeS4Options = {}) {
    this.opts = { host: "my426318-api.s4hana.cloud.sap", prefix: "", ...opts };
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
    this.calls.push({ url, headers });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.host !== this.opts.host) return new Response("wrong host", { status: 502 });
    const m = new RegExp(`^${this.opts.prefix}/sap/opu/odata/sap/(API_BUSINESS_PARTNER|API_PRODUCT_SRV)/(.*)$`).exec(url.pathname);
    if (!m) return json(404, { error: { message: { value: "Resource not found" } } });
    const service = m[1] as "API_BUSINESS_PARTNER" | "API_PRODUCT_SRV";
    const path = decodeURIComponent(m[2]);
    if (!this.authOk(headers)) return json(401, { error: { message: { value: "Unauthorized" } } });
    const denied = this.opts.deny?.[service];
    if (denied) return json(denied, { error: { message: { value: `denied ${denied}` } } });
    if (path === "$metadata") {
      if (this.opts.metadataFails) return new Response("too large", { status: 500 });
      return new Response(service === "API_BUSINESS_PARTNER" ? BP_METADATA : PRODUCT_METADATA, { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (this.opts.throttleOnce && !this.throttled) { this.throttled = true; return new Response("slow down", { status: 429, headers: { "retry-after": "0" } }); }
    const set = path === "A_BusinessPartner" && service === "API_BUSINESS_PARTNER" ? this.bps : path === "A_Product" && service === "API_PRODUCT_SRV" ? this.products : null;
    if (!set) return json(404, { error: { message: { value: "Resource not found for the segment" } } });

    const q = url.searchParams;
    let rows: Row[];
    try { rows = set.filter(evalFilter(q.get("$filter"))); } catch (e) { return json(400, { error: { message: { value: (e as Error).message } } }); }
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
    const expand = q.get("$expand") ? q.get("$expand")!.split(",").map((e) => e.split("/")[0]) : [];
    const shape = (r: Row): Row => {
      const out: Row = { __metadata: r.__metadata };
      for (const [k, v] of Object.entries(r)) {
        if (k === "__metadata") continue;
        if (k.startsWith("to_")) { if (expand.includes(k) && (!select || select.includes(k))) out[k] = v; continue; }
        if (!select || select.includes(k)) out[k] = v;
      }
      return out;
    };
    let next: string | undefined;
    if (hasMore) {
      const n = new URL(url);
      n.host = this.opts.nextHost ?? n.host;
      n.searchParams.set("$skiptoken", String(skip + take));
      n.searchParams.set("$skip", String(skip + take));
      next = n.toString();
    }
    return json(200, { d: { results: page.map(shape), ...(next ? { __next: next } : {}) } });
  };
}
