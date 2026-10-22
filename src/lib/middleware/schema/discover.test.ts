import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/encryption", () => ({ unsealSecret: (v: string) => (v?.startsWith("enc:") ? v.slice(4) : v) }));

import { discoverSchema, fetchSchemaText, readSpecText, validateSchemaUrl, webhookHeaders } from "./discover";
import { countFields, diffSchema } from "./types";
import { fakeAdmin, T1, T2 } from "../testHarness";
import type { TargetField } from "../mapping/types";

const tf = (path: string, over: Partial<TargetField> = {}): TargetField => ({ path, label: path, type: "text", required: false, creatable: true, ...over });
const reply = (body: string, init: ResponseInit = {}) => async () => new Response(body, { status: 200, ...init });

const SPEC = JSON.stringify({ openapi: "3.0.0", paths: { "/x": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { a: { type: "string" } } } } } } } } } });

describe("the address is judged before anything is fetched", () => {
  it("accepts a public https address and drops the fragment", async () => {
    const u = await validateSchemaUrl("https://93.184.216.34/spec.json#frag");
    expect(u.hash).toBe("");
    expect(u.pathname).toBe("/spec.json");
  });

  it("refuses http, private, loopback, metadata and mapped-IPv6 hosts", async () => {
    const refused = [
      "http://93.184.216.34/spec.json", "https://127.0.0.1/spec.json", "https://10.0.0.5/spec.json", "https://192.168.1.1/x", "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x", "https://[::ffff:127.0.0.1]/x", "https://[::ffff:7f00:1]/x", "https://localhost/x", "https://api.internal/x", "ftp://93.184.216.34/x", "file:///etc/passwd", "javascript:alert(1)", "not a url", "",
    ];
    for (const u of refused) await expect(validateSchemaUrl(u), u).rejects.toThrow();
  });

  it("refuses a key in the address and says where it belongs", async () => {
    for (const u of ["https://93.184.216.34/s.json?api_key=abc", "https://93.184.216.34/s.json?token=abc", "https://93.184.216.34/s.json?x=1&access-token=z", "https://93.184.216.34/s.json?Secret=1", "https://user:pw@93.184.216.34/s.json"]) {
      await expect(validateSchemaUrl(u), u).rejects.toThrow(/Put the key in a header/);
    }
    await expect(validateSchemaUrl("https://93.184.216.34/s.json?version=2&country_code=IN")).resolves.toBeInstanceOf(URL);
  });

  it("refuses an address that is not text, or absurdly long", async () => {
    await expect(validateSchemaUrl(undefined)).rejects.toThrow();
    await expect(validateSchemaUrl({ href: "https://x" })).rejects.toThrow();
    await expect(validateSchemaUrl("https://93.184.216.34/" + "a".repeat(2500))).rejects.toThrow(/too long/);
  });
});

describe("fetchSchemaText", () => {
  const url = new URL("https://93.184.216.34/spec.json");

  it("returns the body of a good answer", async () => {
    expect(await fetchSchemaText(url, "openapi", {}, { fetch: reply(SPEC) })).toBe(SPEC);
  });

  it("sends the given headers and an accept header, with a time limit", async () => {
    let seen: RequestInit | undefined;
    await fetchSchemaText(url, "openapi", { "X-Api-Key": "k" }, { fetch: async (_u, init) => { seen = init; return new Response("{}"); } });
    expect((seen!.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    expect(seen!.signal).toBeInstanceOf(AbortSignal);
    expect(seen!.method).toBe("GET");
  });

  it("refuses a file over the size cap: declared in the header, or streamed without one", async () => {
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: reply("{}", { headers: { "content-length": String(6 * 1024 * 1024) } }) })).rejects.toThrow(/larger than 5 MB/);
    const big = "x".repeat(5 * 1024 * 1024 + 10);
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: reply(big) })).rejects.toThrow(/larger than 5 MB/);
    await expect(fetchSchemaText(url, "odata", {}, { fetch: reply("x".repeat(5 * 1024 * 1024 + 10)) })).resolves.toHaveLength(5 * 1024 * 1024 + 10);
  });

  it("a redirect is refused, not followed", async () => {
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }) })).rejects.toThrow(/redirects/);
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: async () => { throw new Error("The address redirected too many times"); } })).rejects.toThrow(/redirects/);
  });

  it("says plainly what went wrong for 401, 404, a timeout and an unreachable host", async () => {
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: async () => new Response("no", { status: 401 }) })).rejects.toThrow(/Send the webhook's headers/);
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: async () => new Response("no", { status: 404 }) })).rejects.toThrow(/HTTP 404/);
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: async () => { const e = new Error("The operation was aborted"); e.name = "TimeoutError"; throw e; } })).rejects.toThrow(/did not answer within 20 seconds/);
    await expect(fetchSchemaText(url, "odata", {}, { fetch: async () => { throw new Error("getaddrinfo ENOTFOUND"); } })).rejects.toThrow(/Could not reach/);
  });

  it("a host that turns out private at fetch time is refused with the plain message", async () => {
    await expect(fetchSchemaText(url, "openapi", {}, { fetch: async () => { throw new Error("That address points at a private or internal network"); } })).rejects.toThrow(/private or internal/);
  });
});

describe("readSpecText", () => {
  it("reads JSON and YAML, and refuses a YAML bomb or a broken JSON", () => {
    expect(readSpecText('{"a":1}')).toEqual({ a: 1 });
    expect(readSpecText("a: 1\nb:\n  - x")).toEqual({ a: 1, b: ["x"] });
    expect(() => readSpecText("a: &a [1,2]\nb: [*a,*a,*a]")).toThrow(/anchors/);
    expect(() => readSpecText("{broken")).toThrow(/JSON/);
    expect(() => readSpecText("x: !!python/object/apply:os.system ['id']")).toThrow(/Use the JSON version/);
  });
});

describe("discoverSchema", () => {
  const a = "https://93.184.216.34/spec.json";

  it("fetches and parses an OpenAPI file, and keeps the address without a fragment", async () => {
    const r = await discoverSchema({ source: "openapi", url: `${a}#x`, operation: { method: "POST", path: "/x" } }, { fetch: reply(SPEC) });
    expect(r.sourceUrl).toBe(a);
    expect(r.parsed).toMatchObject({ ok: true, entity: "POST /x" });
  });

  it("fetches OData $metadata and lets the operation path name the entity set", async () => {
    const xml = `<Edmx><Schema><EntityType Name="E"><Property Name="Id" Type="Edm.String"/></EntityType><EntityContainer><EntitySet Name="Es" EntityType="N.E"/></EntityContainer></Schema></Edmx>`;
    const r = await discoverSchema({ source: "odata", url: "https://93.184.216.34/$metadata", operation: { method: "POST", path: "/Es" } }, { fetch: reply(xml) });
    expect(r.parsed).toMatchObject({ ok: true, entity: "Es" });
  });

  it("never touches the network for a pasted sample or hand-typed fields", async () => {
    const fetch = vi.fn();
    expect((await discoverSchema({ source: "sample", sample: '{"a":1}' }, { fetch })).parsed).toMatchObject({ ok: true });
    expect((await discoverSchema({ source: "manual", fields: [{ path: "a", type: "text" }] }, { fetch })).parsed).toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unsafe address is refused before the fetch is made", async () => {
    const fetch = vi.fn();
    await expect(discoverSchema({ source: "openapi", url: "https://127.0.0.1/s" }, { fetch })).rejects.toThrow(/private or internal/);
    await expect(discoverSchema({ source: "openapi", url: "http://93.184.216.34/s" }, { fetch })).rejects.toThrow(/https/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the webhook's own headers", () => {
  const seed = (tenant: string) => ({
    webhooks: [{ id: "w1", tenant_id: tenant, headers: [{ name: "X-Api-Key", value: "enc:k-123" }, { name: "Bad Name", value: "enc:z" }, { name: "X-Line", value: "enc:a\nb" }] }],
  });

  it("are read for the webhook of THIS tenant only, and bad names or values are dropped", async () => {
    const own = fakeAdmin(seed(T1));
    expect(await webhookHeaders(own.client, T1, "w1")).toEqual({ "X-Api-Key": "k-123" });
    const other = fakeAdmin(seed(T2));
    expect(await webhookHeaders(other.client, T1, "w1")).toEqual({});
  });
});

describe("refresh: nothing is dropped silently", () => {
  const previous = [tf("name"), tf("price"), tf("old_unused"), tf("old_used")];
  const next = [tf("name"), tf("price"), tf("brand_new")];

  it("marks a field not seen before as new, and a mapped field that disappeared as missing", () => {
    const r = diffSchema(previous, next, new Set(["old_used", "name"]));
    expect(r.fields.find((f) => f.path === "brand_new")?.state).toBe("new");
    expect(r.fields.find((f) => f.path === "old_used")).toMatchObject({ state: "missing" });
    expect(r.fields.find((f) => f.path === "old_unused")).toBeUndefined();
    expect(r.counts).toEqual({ total: 3, new: 1, missing: 1 });
  });

  it("the first fetch has nothing to compare with: no field is new", () => {
    expect(diffSchema([], next, new Set()).counts).toEqual({ total: 3, new: 0, missing: 0 });
  });

  it("an earlier new or missing mark is cleared when the field is seen again", () => {
    const r = diffSchema([tf("a", { state: "new" })], [tf("a")], new Set());
    expect(r.fields[0].state).toBeUndefined();
    const back = diffSchema([tf("gone", { state: "missing" })], [tf("gone")], new Set(["gone"]));
    expect(back.fields[0].state).toBeUndefined();
  });

  it("counts header and lines together", () => {
    expect(countFields([tf("a"), tf("b", { state: "new" })], [tf("c", { state: "missing" })])).toEqual({ total: 2, new: 1, missing: 1 });
  });
});
