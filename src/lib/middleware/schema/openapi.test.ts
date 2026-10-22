import { describe, expect, it } from "vitest";
import { parseOpenApi, pathMatches } from "./openapi";
import { parseYaml, YamlError } from "./yaml";

const v3 = {
  openapi: "3.0.3",
  paths: {
    "/v2/orders": {
      post: {
        summary: "Create an order",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
      },
      get: { summary: "List orders" },
    },
    "/v2/orders/{id}": { patch: { summary: "Change an order", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } } } },
    "/v2/ping": { get: {} },
  },
  components: {
    schemas: {
      Order: {
        type: "object", required: ["number", "customer"],
        properties: {
          number: { type: "string", title: "Order number" },
          customer: { $ref: "#/components/schemas/Customer" },
          currency: { type: "string", enum: ["INR", "USD"] },
          due: { type: "string", format: "date" },
          placedAt: { type: "string", format: "date-time" },
          total: { type: "number" },
          paid: { type: "boolean" },
          id: { type: "string", readOnly: true },
          tags: { type: "array", items: { type: "string" } },
          items: { type: "array", items: { $ref: "#/components/schemas/Item" } },
          notes: { type: "array", items: { $ref: "#/components/schemas/Item" } },
        },
      },
      Customer: { type: "object", required: ["name"], properties: { name: { type: "string" }, address: { type: "object", properties: { city: { type: "string" } } }, parent: { $ref: "#/components/schemas/Customer" } } },
      Item: { type: "object", required: ["qty"], properties: { sku: { type: "string" }, qty: { type: "integer" }, unit: { type: "string", enum: ["EA", "M", "KG"] } } },
    },
  },
};

describe("parseOpenApi 3.x", () => {
  it("takes the request body of the chosen operation, flattening objects to a.b and marking required", () => {
    const r = parseOpenApi(v3, { method: "POST", path: "/v2/orders" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entity).toBe("POST /v2/orders");
    const by = Object.fromEntries(r.fields.map((f) => [f.path, f]));
    expect(by.number).toMatchObject({ type: "text", required: true, label: "Order number" });
    expect(by["customer.name"]).toMatchObject({ type: "text", required: true });
    expect(by["customer.address.city"]).toMatchObject({ type: "text", required: false });
    expect(by.currency).toMatchObject({ type: "enum", enum: ["INR", "USD"] });
    expect(by.due.type).toBe("date");
    expect(by.placedAt.type).toBe("datetime");
    expect(by.total.type).toBe("number");
    expect(by.paid.type).toBe("boolean");
    expect(by.id.creatable).toBe(false);
    expect(by.tags.type).toBe("array");
  });

  it("offers the first array of objects as the lines block, the others stay plain array fields", () => {
    const r = parseOpenApi(v3, { method: "POST", path: "/v2/orders" });
    if (!r.ok) throw new Error(r.message);
    expect(r.linesPath).toBe("items");
    expect(r.lineFields.map((f) => f.path).sort()).toEqual(["qty", "sku", "unit"]);
    expect(r.lineFields.find((f) => f.path === "qty")).toMatchObject({ type: "integer", required: true });
    expect(r.lineFields.find((f) => f.path === "unit")).toMatchObject({ type: "enum", enum: ["EA", "M", "KG"] });
    expect(r.fields.find((f) => f.path === "notes")?.type).toBe("array");
  });

  it("survives a $ref cycle (Customer.parent -> Customer) without looping", () => {
    const r = parseOpenApi(v3, { method: "POST", path: "/v2/orders" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.some((f) => f.path.startsWith("customer.parent"))).toBe(false);
  });

  it("matches a templated path from a concrete one and the other way round", () => {
    expect(pathMatches("/v2/orders/{id}", "/v2/orders/42")).toBe(true);
    expect(pathMatches("/v2/orders/{id}", "/v2/orders/{orderId}")).toBe(true);
    expect(pathMatches("/v2/orders", "/v2/orders/42")).toBe(false);
    const r = parseOpenApi(v3, { method: "PATCH", path: "/v2/orders/42" });
    expect(r.ok && r.operation).toEqual({ method: "PATCH", path: "/v2/orders/{id}" });
  });

  it("with no operation named: one candidate is taken, several are listed", () => {
    const list = parseOpenApi(v3);
    expect(list.ok).toBe(false);
    expect(!list.ok && list.operations?.map((o) => `${o.method} ${o.path}`)).toEqual(["POST /v2/orders", "PATCH /v2/orders/{id}"]);
    const single = { openapi: "3.1.0", paths: { "/x": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { a: { type: "string" } } } } } } } } } };
    expect(parseOpenApi(single)).toMatchObject({ ok: true, entity: "POST /x" });
  });

  it("no operation matches: says so and returns the list to pick from", () => {
    const r = parseOpenApi(v3, { method: "POST", path: "/nope" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.operations?.length).toBe(2);
  });

  it("an operation without a body is refused with the list", () => {
    const r = parseOpenApi(v3, { method: "GET", path: "/v2/orders" });
    expect(!r.ok && r.message).toMatch(/takes no request body/);
  });

  it("merges allOf and notes that oneOf shows its first shape", () => {
    const doc = {
      openapi: "3.0.0",
      paths: { "/a": { post: { requestBody: { content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", required: ["x"], properties: { x: { type: "integer" } } }] } } } } } } },
      components: { schemas: { Base: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
    };
    const r = parseOpenApi(doc, { method: "POST", path: "/a" });
    expect(r.ok && r.fields.map((f) => [f.path, f.required])).toEqual(expect.arrayContaining([["id", true], ["x", true]]));
    const one = { openapi: "3.0.0", paths: { "/a": { post: { requestBody: { content: { "application/json": { schema: { oneOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "string" } } }] } } } } } } } };
    const r2 = parseOpenApi(one, { method: "POST", path: "/a" });
    expect(r2.ok && r2.fields.map((f) => f.path)).toEqual(["a"]);
    expect(r2.ok && r2.notes.join(" ")).toMatch(/first one is shown/);
  });

  it("refuses an external $ref and a document that is not OpenAPI", () => {
    const ext = { openapi: "3.0.0", paths: { "/a": { post: { requestBody: { content: { "application/json": { schema: { $ref: "https://evil.example/s.json" } } } } } } } };
    expect(parseOpenApi(ext, { method: "POST", path: "/a" })).toMatchObject({ ok: false });
    for (const bad of [null, "text", 5, [], {}, { swagger: "1.2" }, { openapi: "2.0" }]) expect(parseOpenApi(bad)).toMatchObject({ ok: false });
  });

  it("a hostile document cannot reach the prototype and a deep chain of refs is cut", () => {
    const doc = { openapi: "3.0.0", paths: { "/a": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { __proto__: { type: "string" }, constructor: { type: "string" }, ok: { type: "string" } } } } } } } } } };
    const r = parseOpenApi(JSON.parse(JSON.stringify(doc).replace('"__proto__"', '"__proto__"')), { method: "POST", path: "/a" });
    expect(r.ok && r.fields.map((f) => f.path)).toEqual(["ok"]);
    const chain: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) chain[`S${i}`] = { type: "object", properties: { next: { $ref: `#/components/schemas/S${i + 1}` }, v: { type: "string" } } };
    chain.S30 = { type: "object", properties: { v: { type: "string" } } };
    const deep = { openapi: "3.0.0", paths: { "/a": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/S0" } } } } } } }, components: { schemas: chain } };
    const rd = parseOpenApi(deep, { method: "POST", path: "/a" });
    expect(rd.ok && rd.fields.length).toBeLessThan(15);
  });

  it("cuts a block at 500 fields, required first, and says so", () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < 600; i++) props[`f${String(i).padStart(3, "0")}`] = { type: "string" };
    const doc = { openapi: "3.0.0", paths: { "/a": { post: { requestBody: { content: { "application/json": { schema: { type: "object", required: ["f599"], properties: props } } } } } } } };
    const r = parseOpenApi(doc, { method: "POST", path: "/a" });
    expect(r.ok && r.fields).toHaveLength(500);
    expect(r.ok && r.fields[0].path).toBe("f599");
    expect(r.ok && r.notes[0]).toMatch(/cut at 500 of 600/);
  });
});

describe("parseOpenApi Swagger 2.0", () => {
  const v2 = {
    swagger: "2.0",
    paths: { "/orders": { post: { parameters: [{ in: "body", name: "body", schema: { $ref: "#/definitions/Order" } }] } } },
    definitions: { Order: { type: "object", required: ["ref"], properties: { ref: { type: "string" }, lines: { type: "array", items: { $ref: "#/definitions/Line" } } } }, Line: { type: "object", properties: { qty: { type: "number" } } } },
  };
  it("reads the in: body parameter and its definitions", () => {
    const r = parseOpenApi(v2, { method: "POST", path: "/orders" });
    expect(r.ok && r.fields.map((f) => [f.path, f.required])).toEqual([["ref", true]]);
    expect(r.ok && r.linesPath).toBe("lines");
    expect(r.ok && r.lineFields[0]).toMatchObject({ path: "qty", type: "number" });
  });
});

describe("the YAML reader", () => {
  const yaml = `
openapi: "3.0.3"
info:
  title: Orders  # a comment
  description: |
    Line one
    Line two
paths:
  /v2/orders:
    post:
      summary: 'Create it'
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [number, customer]
              properties:
                number: {type: string}
                customer:
                  type: string
                items:
                  type: array
                  items:
                    type: object
                    properties:
                      sku:
                        type: string
                      qty:
                        type: integer
                      unit:
                        type: string
                        enum:
                          - EA
                          - M
`;
  it("reads the subset an OpenAPI file uses, and the result parses like JSON", () => {
    const doc = parseYaml(yaml) as { info: { description: string; title: string } };
    expect(doc.info.title).toBe("Orders");
    expect(doc.info.description).toBe("Line one\nLine two");
    const r = parseOpenApi(doc, { method: "POST", path: "/v2/orders" });
    expect(r.ok && r.fields.map((f) => [f.path, f.required])).toEqual([["customer", true], ["number", true]]);
    expect(r.ok && r.lineFields.find((f) => f.path === "unit")).toMatchObject({ type: "enum", enum: ["EA", "M"] });
  });

  it("lists written at the same indent as their name, and a list of maps", () => {
    expect(parseYaml("a:\n- 1\n- 2\nb:\n  - x: 1\n    y: 2\n  - x: 3\n")).toEqual({ a: [1, 2], b: [{ x: 1, y: 2 }, { x: 3 }] });
  });

  it("refuses anchors, aliases, merge keys, tags, a second document and tabs", () => {
    for (const bad of ["a: &x 1\nb: *x", "a: !!js/function 'x'", "<<: {a: 1}", "a: 1\n---\nb: 2\n---\n", "a:\n\tb: 1", "k: *alias", "a: !Ref x"]) {
      expect(() => parseYaml(bad), bad).toThrow(YamlError);
    }
  });

  it("refuses a name that would reach the prototype", () => {
    expect(() => parseYaml("__proto__:\n  polluted: 1")).toThrow(YamlError);
    expect(() => parseYaml("a: {constructor: 1}")).toThrow(YamlError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("is not defeated by a deeply nested or very long file", () => {
    const deep = Array.from({ length: 100 }, (_, i) => `${" ".repeat(i * 2)}k${i}:`).join("\n");
    expect(() => parseYaml(deep)).toThrow(YamlError);
    expect(() => parseYaml("a: " + "x".repeat(300_000))).toThrow(YamlError);
  });
});
