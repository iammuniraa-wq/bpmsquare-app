// Generates an OpenAPI 3.0 document for the v1 API from the same metadata
// registry the validation + docs use -- the modern equivalent of OData's
// $metadata (JSON, so Postman / Insomnia / SAP CPI / codegen consume it
// directly). Regenerating is free; there is no second spec to keep in sync.

import type { EntityDef, FieldDef, FieldType } from "./schema";
import { API_ENTITIES, UNDOCUMENTED_ENDPOINTS } from "./registry";

function fieldSchema(f: FieldDef): Record<string, unknown> {
  const base: Record<string, unknown> = { description: f.description || f.label };
  const map: Record<FieldType, Record<string, unknown>> = {
    string: { type: "string" }, text: { type: "string" }, richtext: { type: "string" },
    uuid: { type: "string", format: "uuid" }, enum: { type: "string" },
    number: { type: "number" }, integer: { type: "integer" }, boolean: { type: "boolean" },
    date: { type: "string", format: "date" }, datetime: { type: "string", format: "date-time" },
    "uuid[]": { type: "array", items: { type: "string", format: "uuid" } },
    json: { type: "object" },
  };
  Object.assign(base, map[f.type] ?? { type: "string" });
  if (f.enumValues) base.enum = [...f.enumValues];
  if (f.readOnly || f.computed) base.readOnly = true;
  if (f.maxLength) base.maxLength = f.maxLength;
  if (f.min != null) base.minimum = f.min;
  if (f.max != null) base.maximum = f.max;
  if (f.example !== undefined) base.example = f.example;
  return base;
}

function entitySchema(def: EntityDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of def.fields) properties[f.key] = fieldSchema(f);
  const required = def.fields.filter((f) => f.required).map((f) => f.key);
  return { type: "object", description: def.description, properties, ...(required.length ? { required } : {}) };
}

// The shared enriched-query params every list GET accepts.
const QUERY_PARAMS = [
  { name: "select", description: "Comma list of fields to return; dotted for nested (e.g. account.name)." },
  { name: "filter", description: "field:op:value triples joined by ';' (AND). ops: eq ne gt gte lt lte like in isnull." },
  { name: "sort", description: "Comma list; leading '-' = descending (e.g. -total,ref)." },
  { name: "search", description: "OR-contains across the entity's searchable fields." },
  { name: "group_by", description: "Aggregate per distinct value of this field (results in meta.groups)." },
  { name: "aggregate", description: "count,sum:field,avg:field,min:field,max:field over the filtered set." },
  { name: "page", description: "1-based page number.", schema: { type: "integer", default: 1 } },
  { name: "limit", description: "Page size (max 200).", schema: { type: "integer", default: 50, maximum: 200 } },
  { name: "count", description: "'only' returns meta without the row payload.", schema: { type: "string", enum: ["only"] } },
].map((p) => ({ in: "query", name: p.name, required: false, schema: p.schema ?? { type: "string" }, description: p.description }));

export function buildOpenApiSpec(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {
    Error: {
      type: "object",
      properties: {
        error: { type: "string" },
        message: { type: "string" },
        details: { type: "array", items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } } },
      },
    },
    ListMeta: {
      type: "object",
      properties: {
        count: { type: "integer", description: "Rows on this page." },
        total: { type: "integer", description: "Rows after filtering, before pagination." },
        page: { type: "integer" }, limit: { type: "integer" }, has_more: { type: "boolean" },
        aggregates: { type: "object", additionalProperties: { type: "number" } },
        groups: { type: "array", items: { type: "object" } },
      },
    },
  };

  const paths: Record<string, unknown> = {};
  const listResponse = (schemaRef?: string) => ({
    "200": {
      description: "OK",
      content: { "application/json": { schema: {
        type: "object",
        properties: {
          data: { type: "array", items: schemaRef ? { $ref: `#/components/schemas/${schemaRef}` } : { type: "object" } },
          meta: { $ref: "#/components/schemas/ListMeta" },
          _links: { type: "object" },
        },
      } } },
    },
    "401": { description: "Missing/invalid tenant API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    "422": { description: "Invalid query (unknown field / bad operator)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  });

  // Documented entities (full field schema; quotations also has writes).
  for (const [key, def] of Object.entries(API_ENTITIES)) {
    const schemaName = def.name.replace(/\s+/g, "");
    schemas[schemaName] = entitySchema(def);
    const base = def.endpoint.replace("/api/v1", "");
    paths[base] = {
      get: { summary: `List ${def.plural}`, tags: [def.plural], parameters: QUERY_PARAMS, responses: listResponse(schemaName) },
      post: {
        summary: `Create a ${def.name}`, tags: [def.plural],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } },
        responses: { "201": { description: "Created" }, "422": { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
      },
    };
    paths[`${base}/{id}`] = {
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      get: { summary: `Get a ${def.name}`, tags: [def.plural], responses: { "200": { description: "OK" }, "404": { description: "Not in your tenant" } } },
      patch: { summary: `Update a ${def.name}`, tags: [def.plural], requestBody: { content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } }, responses: { "200": { description: "OK" }, "404": { description: "Not in your tenant" } } },
      delete: { summary: `Delete a ${def.name}`, tags: [def.plural], responses: { "200": { description: "OK" }, "404": { description: "Not in your tenant" } } },
      key,
    };
  }

  // Read-only endpoints without a full EntityDef yet: still get the query layer.
  for (const ep of UNDOCUMENTED_ENDPOINTS) {
    const base = ep.replace("/api/v1", "");
    if (paths[base]) continue;
    const tag = base.slice(1);
    paths[base] = { get: { summary: `List ${tag}`, tags: [tag], parameters: QUERY_PARAMS, responses: listResponse() } };
    paths[`${base}/{id}`] = {
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      get: { summary: `Get one ${tag} record`, tags: [tag], responses: { "200": { description: "OK" }, "404": { description: "Not in your tenant" } } },
    };
  }

  // Cross-cutting endpoints without an entity schema: the change feed and the
  // natural-language query. Added explicitly so the spec is complete.
  paths["/changes"] = {
    get: {
      summary: "Change feed (CDC)", tags: ["changes"],
      parameters: [
        { in: "query", name: "since", schema: { type: "string" }, description: "Cursor from a previous response." },
        { in: "query", name: "object_type", schema: { type: "string" }, description: "Filter to one object type." },
        { in: "query", name: "limit", schema: { type: "integer", default: 100, maximum: 500 } },
      ],
      responses: { "200": { description: "Ordered changes with a next cursor" }, "401": { description: "Missing/invalid tenant API key" } },
    },
  };
  paths["/price"] = {
    post: {
      summary: "Price a document (PricingEngine)", tags: ["pricing"],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object",
        properties: {
          document: { type: "object", properties: {
            attributes: { type: "object", description: "Header matching attributes (document_type, customer.*, region, ...)." },
            lines: { type: "array", items: { type: "object", properties: {
              line_no: { type: "integer" },
              attributes: { type: "object" },
              quantity: { type: "number" },
              weight_kg: { type: "number" },
              cost_items: { type: "array", items: { type: "object", properties: { path: { type: "string" }, qty: { type: "number" } }, required: ["path", "qty"] } },
              manual: { type: "object", description: "Per-component manual overrides {CODE: {value, reason}} — gated by each component's override policy." },
            } } },
          }, required: ["lines"] },
          options: { type: "object", properties: {
            trace: { type: "string", enum: ["full", "summary", "none"], default: "full" },
            pricing_date: { type: "string", format: "date" },
            config_version: { type: "integer", description: "Replay against a specific config version (default: the PUBLISHED one)." },
            pricing_area: { type: "string", default: "default" },
            procedure: { type: "string", description: "Procedure code; required when the version has more than one." },
            currency: { type: "string" },
          } },
        },
        required: ["document"],
      } } } },
      responses: {
        "200": { description: "Priced document with waterfall trace (APPLIED/EXCLUDED/SKIPPED per step)" },
        "409": { description: "No PUBLISHED pricing configuration for this tenant/area" },
        "422": { description: "Invalid document, or a configuration error (AMBIGUOUS_RULE, MISSING_REQUIRED_COMPONENT, FORMULA_ERROR, ...)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  };
  paths["/ask"] = {
    post: {
      summary: "Natural-language query", tags: ["ask"],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object",
        properties: { object: { type: "string", description: "Object to query (e.g. quotations)." }, question: { type: "string", description: "Plain-English question." } },
        required: ["object", "question"],
      } } } },
      responses: {
        "200": { description: "Compiled query + results (or answerable:false)" },
        "422": { description: "Unknown object, or the compiled query failed validation", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "503": { description: "AI not configured on the server" },
      },
    },
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "BPMSquare REST API",
      version: "1.0.0",
      description:
        "Tenant-scoped REST API. Authenticate with a per-tenant Bearer API key (Settings → Admin → this tenant); the tenant is resolved from the key, never from the request path. Every list endpoint accepts the enriched query layer (select/filter/sort/paginate/aggregate/search/group_by).",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Per-tenant API key." } },
      schemas,
    },
    paths,
  };
}
