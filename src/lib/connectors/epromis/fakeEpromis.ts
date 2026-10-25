// A fake REST server for the ePROMIS connector's tests (like fakeS4.ts): an in-memory fetch, no network. Its API is
// INVENTED -- ePROMIS publishes no documentation -- so the paths and field names below are this fake's own and prove the
// connector's machinery (auth, paging, mapping, errors), not any claim about ePROMIS. It checks the login the way a real
// server would, can be told to fail, hang, drop the connection, or echo the request into an error page, and records
// every call. Not a test file.

import type { EndpointMap, EpromisConfig } from "./types";

export const FAKE_BASE = "https://api.fake-epromis.example/v1";

export type FakeAuth =
  | { type: "api_key"; header: string; secret: string }
  | { type: "bearer"; secret: string }
  | { type: "basic"; username: string; secret: string };

export type FakeOptions = {
  auth: FakeAuth;
  company?: { name: string; value: string; in: "header" | "query" };
  /** Rows per page for the lists; the answer then names the next page. */
  pageSize?: number;
  /** Every call answers this (status and raw body). */
  fail?: { status: number; body?: string };
  /** The error page echoes the request's headers, as a careless server does. */
  echoHeaders?: boolean;
  /** The first call drops the connection (a thrown network error). */
  networkErrorOnce?: boolean;
  /** Every call never answers until the caller aborts. */
  hang?: boolean;
  /** Every call answers with a redirect to this address. */
  redirectTo?: string;
  /** The base address answers 404 (an API without a front page). */
  rootStatus?: number;
  /** A body larger than any cap. */
  hugeBody?: boolean;
};

export type RecordedCall = { method: string; url: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown };

export type FakeEpromis = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: RecordedCall[];
  projects: Map<string, { code: string; name: string; id: string; body: Record<string, unknown> }>;
  budgets: Map<string, Record<string, unknown>>;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const FAKE_RESOURCES = [
  { Code: "11", Name: "Material", Parent: null, Inventory: false, Validate: true },
  { Code: "1105", Name: "Metals", Parent: "11", Inventory: false, Validate: true },
  { Code: "110510", Name: "Slotted Channel Framing", Parent: "1105", Inventory: true, Validate: true },
  { Code: "31", Name: "Man Power", Parent: null, Inventory: false, Validate: false },
  { Code: "41", Name: "Sub Contractor", Parent: null, Inventory: false, Validate: false },
];
export const FAKE_COST_CODES = [
  { Code: "00", Name: "Procurement and Contracting", Parent: null },
  { Code: "0010", Name: "Solicitation", Parent: "00" },
  { Code: "0041", Name: "Bid Forms", Parent: "00" },
];
export const FAKE_JUSTIFICATIONS = [{ Code: "VAR", Name: "Client variation" }, { Code: "SCOPE", Name: "Scope change" }];
export const FAKE_TENDERS = [{ Code: "T-001", Name: "Warehouse precast", Parent: null }, { Code: "T-002", Name: "School block", Parent: null }];

/** The endpoint map that points the connector at this fake's invented API. */
export const FAKE_ENDPOINTS: EndpointMap = {
  ping: { path: "/ping" },
  list_tenders: { path: "/tenders", rows_path: "data.items", next_path: "data.next", fields: { code: "Code", name: "Name", parent_code: "Parent" } },
  list_resources: {
    path: "/resources", rows_path: "data.items", next_path: "data.next",
    fields: { code: "Code", name: "Name", parent_code: "Parent" }, flags: { link_to_inventory: "Inventory", budget_validation: "Validate" },
  },
  list_cost_codes: { path: "/costcodes", rows_path: "data.items", next_path: "data.next", fields: { code: "Code", name: "Name", parent_code: "Parent" } },
  list_justifications: { path: "/justifications", rows_path: "data.items", fields: { code: "Code", name: "Name" } },
  get_project: { path: "/projects/{code}", rows_path: "data", fields: { code: "ProjectCode", name: "ProjectName", id: "Id" } },
  create_project: {
    path: "/projects", id_path: "data.Id",
    body: { ProjectCode: "{code}", ProjectName: "{name}", "Client.Name": "{client_name}", ContractValue: "{contract_value}", Ref: "BPM-{source_ref}" },
  },
  create_budget: {
    path: "/projects/{project_code}/budget", id_path: "data.BudgetId",
    body: { ProjectCode: "{project_code}", Rev: "{revision_no}", Total: "{total}", Reason: "{justification_code}" },
    lines_path: "Lines", line: { No: "{line_no}", Resource: "{resource_code}", CostCode: "{cost_code}", Amount: "{amount}", Qty: "{qty}" },
  },
  replace_budget: {
    path: "/projects/{project_code}/budget", method: "PUT", id_path: "data.BudgetId",
    body: { ProjectCode: "{project_code}", Rev: "{revision_no}", Total: "{total}" },
    lines_path: "Lines", line: { No: "{line_no}", Resource: "{resource_code}", CostCode: "{cost_code}", Amount: "{amount}" },
  },
};

/** A connection config for the fake, with the endpoint map filled. */
export function fakeConfig(auth: FakeAuth, over: Partial<EpromisConfig> = {}): EpromisConfig {
  return {
    base_url: FAKE_BASE,
    auth_type: auth.type,
    key_header: auth.type === "api_key" ? auth.header : "",
    username: auth.type === "basic" ? auth.username : "",
    company_name: "", company_value: "", company_in: "header",
    endpoints: FAKE_ENDPOINTS,
    ...over,
  };
}

export function createFakeEpromis(opts: FakeOptions): FakeEpromis {
  const calls: RecordedCall[] = [];
  const projects: FakeEpromis["projects"] = new Map();
  const budgets: FakeEpromis["budgets"] = new Map();
  let dropped = false;
  let seq = 100;

  function authorised(h: Headers, url: URL): boolean {
    const a = opts.auth;
    if (a.type === "api_key" ? h.get(a.header) !== a.secret
      : a.type === "bearer" ? h.get("authorization") !== `Bearer ${a.secret}`
        : h.get("authorization") !== `Basic ${Buffer.from(`${a.username}:${a.secret}`).toString("base64")}`) return false;
    const c = opts.company;
    if (c) {
      const got = c.in === "header" ? h.get(c.name) : url.searchParams.get(c.name);
      if (got !== c.value) return false;
    }
    return true;
  }

  function page(all: Record<string, unknown>[], url: URL, path: string) {
    const size = opts.pageSize ?? all.length;
    const p = Number(url.searchParams.get("page") ?? "1");
    const items = all.slice((p - 1) * size, p * size);
    const more = p * size < all.length;
    // The next link carries the company query value the way a real server's link would.
    return json(200, { data: { items, next: more ? `${path}?page=${p + 1}` : null } });
  }

  const fetch: FakeEpromis["fetch"] = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const path = url.pathname.replace(/^\/v1/, "") || "/";
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    calls.push({ method, url: rawUrl, path, query, headers, body });

    if (opts.hang) await new Promise<void>((_r, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (opts.networkErrorOnce && !dropped) { dropped = true; throw new TypeError("fetch failed: ECONNRESET"); }
    if (opts.redirectTo) return new Response(null, { status: 302, headers: { location: opts.redirectTo } });
    if (opts.hugeBody) return new Response("x".repeat(6 * 1024 * 1024), { status: 200 });
    if (opts.fail) {
      const echoed = opts.echoHeaders ? ` request headers: ${JSON.stringify(headers)}` : "";
      return new Response(opts.fail.body !== undefined ? `${opts.fail.body}${echoed}` : echoed, { status: opts.fail.status });
    }
    if (!authorised(new Headers(init.headers), url)) return json(401, { error: { message: "Invalid credentials" } });

    if (path === "/" || path === "") return new Response(null, { status: opts.rootStatus ?? 200 });
    if (path === "/ping") return json(200, { status: "ok" });
    if (path === "/tenders") return page(FAKE_TENDERS, url, "/v1/tenders");
    if (path === "/resources") return page(FAKE_RESOURCES, url, "/v1/resources");
    if (path === "/costcodes") return page(FAKE_COST_CODES, url, "/v1/costcodes");
    if (path === "/justifications") return page(FAKE_JUSTIFICATIONS, url, "/v1/justifications");

    const proj = /^\/projects\/([^/]+)$/.exec(path);
    if (proj && method === "GET") {
      const p = projects.get(decodeURIComponent(proj[1]));
      return p ? json(200, { data: { ProjectCode: p.code, ProjectName: p.name, Id: p.id } }) : json(404, { error: { message: "Project not found" } });
    }
    if (path === "/projects" && method === "POST") {
      const b = (body ?? {}) as Record<string, unknown>;
      if (!b.ProjectCode || !b.ProjectName) return json(422, { error: { message: "ProjectCode and ProjectName are required" } });
      if (projects.has(String(b.ProjectCode))) return json(409, { error: { message: "Project already exists" } });
      const id = `P${++seq}`;
      projects.set(String(b.ProjectCode), { code: String(b.ProjectCode), name: String(b.ProjectName), id, body: b });
      return json(201, { data: { Id: id } });
    }
    const bud = /^\/projects\/([^/]+)\/budget$/.exec(path);
    if (bud && (method === "POST" || method === "PUT")) {
      const code = decodeURIComponent(bud[1]);
      if (!projects.has(code)) return json(404, { error: { message: "Project not found" } });
      if (method === "POST" && budgets.has(code)) return json(409, { error: { message: "Budget already exists" } });
      if (method === "PUT" && !budgets.has(code)) return json(404, { error: { message: "No budget to replace" } });
      budgets.set(code, (body ?? {}) as Record<string, unknown>);
      return json(method === "POST" ? 201 : 200, { data: { BudgetId: `B${++seq}` } });
    }
    return json(404, { error: { message: "No such resource" } });
  };

  return { fetch, calls, projects, budgets };
}
