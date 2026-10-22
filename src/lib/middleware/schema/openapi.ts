import type { FieldType, TargetField } from "../mapping/types";
import { LIMITS, UNSAFE_KEYS, capFields, humanize, sortFields, type ParseOutcome, type SchemaOperation } from "./types";

// OpenAPI 3.x and Swagger 2.0 -> the request body of ONE operation as a field list (spec section 2). Local $ref only,
// cycle guard, depth 6; allOf merged, oneOf takes the first branch and says so. Pure: the document is already parsed.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

class Walker {
  notes: string[] = [];
  private refCount = 0;
  constructor(private root: Json) {}

  /** A local `$ref` (`#/components/schemas/X`) resolved; anything else is refused. */
  deref(node: unknown, stack: string[]): Json | null {
    let cur = node;
    for (let hops = 0; hops < LIMITS.refDepth + 2; hops++) {
      if (!isObj(cur) || typeof cur.$ref !== "string") return isObj(cur) ? cur : null;
      const ref = cur.$ref;
      if (!ref.startsWith("#/")) { this.note("An external reference was not followed."); return null; }
      if (stack.includes(ref)) return { type: "object", "x-cycle": true };
      if (stack.length >= LIMITS.refDepth) { this.note("A deeply nested reference was not expanded."); return null; }
      if (++this.refCount > 5000) return null;
      stack = [...stack, ref];
      cur = this.pointer(ref);
    }
    return null;
  }

  private pointer(ref: string): unknown {
    let cur: unknown = this.root;
    for (const raw of ref.slice(2).split("/")) {
      const k = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      if (UNSAFE_KEYS.has(k) || !isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return null;
      cur = cur[k];
    }
    return cur;
  }

  note(m: string) { if (!this.notes.includes(m)) this.notes.push(m); }

  /** The schema with `$ref`, `allOf` and `oneOf`/`anyOf` folded in. */
  effective(schema: unknown, stack: string[]): Json {
    const s = this.deref(schema, stack) ?? {};
    // deref pushes onto a copy of the stack; recompute the stack for children from the ref this node used.
    const refStack = isObj(schema) && typeof schema.$ref === "string" ? [...stack, schema.$ref] : stack;
    let out: Json = { ...s };
    if (Array.isArray(s.allOf)) {
      const props: Json = isObj(s.properties) ? { ...s.properties } : {};
      const req = new Set<string>(Array.isArray(s.required) ? (s.required as unknown[]).filter((x): x is string => typeof x === "string") : []);
      for (const part of s.allOf) {
        const p = this.effective(part, refStack);
        if (isObj(p.properties)) Object.assign(props, p.properties);
        if (Array.isArray(p.required)) for (const r of p.required) if (typeof r === "string") req.add(r);
        if (!out.type && typeof p.type === "string") out.type = p.type;
        if (!out.items && p.items) out.items = p.items;
        if (!out.enum && p.enum) out.enum = p.enum;
        if (!out.format && p.format) out.format = p.format;
      }
      out = { ...out, properties: props, required: [...req], type: out.type ?? "object" };
    }
    for (const key of ["oneOf", "anyOf"] as const) {
      const alts = s[key];
      if (Array.isArray(alts) && alts.length) {
        if (alts.length > 1) this.note("Where the spec offers several shapes, the first one is shown.");
        const first = this.effective(alts[0], refStack);
        out = { ...first, ...out, properties: { ...(isObj(first.properties) ? first.properties : {}), ...(isObj(out.properties) ? out.properties : {}) } };
        if (!out.type) out.type = first.type;
      }
    }
    return out;
  }
}

function fieldType(s: Json): FieldType {
  const t = Array.isArray(s.type) ? (s.type as unknown[]).find((x) => x !== "null") : s.type;
  if (Array.isArray(s.enum) && s.enum.length && (t === "string" || t === "integer" || t === "number" || t === undefined)) return "enum";
  if (t === "integer") return "integer";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "array") return "array";
  if (t === "object") return "object";
  if (t === "string" && s.format === "date") return "date";
  if (t === "string" && s.format === "date-time") return "datetime";
  return "text";
}

type Flat = { fields: TargetField[]; lines: { name: string; items: Json } | null };

function flatten(w: Walker, schema: Json, prefix: string, required: boolean, stack: string[], depth: number, top: boolean, out: Flat): void {
  if (depth > LIMITS.refDepth + 2) { w.note("Deeply nested objects were cut."); return; }
  const props = isObj(schema.properties) ? schema.properties : {};
  const req = new Set<string>(Array.isArray(schema.required) ? (schema.required as unknown[]).filter((x): x is string => typeof x === "string") : []);
  for (const name of Object.keys(props)) {
    if (UNSAFE_KEYS.has(name) || name === "") continue;
    const raw = props[name];
    const refKey = isObj(raw) && typeof raw.$ref === "string" ? raw.$ref : null;
    const child = w.effective(raw, stack);
    const childStack = refKey ? [...stack, refKey] : stack;
    const path = prefix ? `${prefix}.${name}` : name;
    const isReq = required && req.has(name);
    const type = fieldType(child);
    const label = typeof child.title === "string" && child.title.trim() ? child.title.trim().slice(0, 80) : humanize(name);
    const readOnly = child.readOnly === true;
    if (child["x-cycle"]) { w.note("A field that contains itself was left out."); continue; }
    if (type === "object" && isObj(child.properties) && Object.keys(child.properties).length && !child["x-cycle"]) {
      flatten(w, child, path, isReq, childStack, depth + 1, false, out);
      continue;
    }
    if (type === "array") {
      const items = w.effective(child.items, childStack);
      if (top && !out.lines && fieldType(items) === "object" && isObj(items.properties)) { out.lines = { name, items }; continue; }
      out.fields.push({ path, label, type: "array", required: false, creatable: !readOnly });
      continue;
    }
    const f: TargetField = { path, label, type: type === "object" ? "object" : type, required: isReq, creatable: !readOnly };
    if (type === "enum") f.enum = (child.enum as unknown[]).filter((v) => v !== null && v !== undefined).map((v) => String(v)).slice(0, 500);
    out.fields.push(f);
  }
}

// ── Operation choice ─────────────────────────────────────────────────────────

const segs = (p: string) => p.split("?")[0].split("/").filter(Boolean);

/** A concrete or templated path against a spec path: `{id}` segments match any segment on either side. */
export function pathMatches(specPath: string, wanted: string): boolean {
  const a = segs(specPath);
  const b = segs(wanted);
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i] || /^\{[^}]+\}$/.test(s) || /^\{[^}]+\}$/.test(b[i]));
}

function operationsOf(doc: Json): { method: string; path: string; op: Json; pathItem: Json }[] {
  const paths = isObj(doc.paths) ? doc.paths : {};
  const out: { method: string; path: string; op: Json; pathItem: Json }[] = [];
  for (const path of Object.keys(paths).sort()) {
    const item = paths[path];
    if (!isObj(item) || UNSAFE_KEYS.has(path)) continue;
    for (const m of METHODS) if (isObj(item[m])) out.push({ method: m.toUpperCase(), path, op: item[m] as Json, pathItem: item });
  }
  return out;
}

function bodySchemaOf(w: Walker, doc: Json, op: Json, pathItem: Json, v2: boolean): unknown {
  if (v2) {
    const params = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])];
    for (const p of params) {
      const r = w.deref(p, []);
      if (r && r.in === "body") return r.schema;
    }
    return undefined;
  }
  const rb = w.deref(op.requestBody, []);
  const content = rb && isObj(rb.content) ? rb.content : null;
  if (!content) return undefined;
  const key = Object.keys(content).find((k) => k === "application/json") ?? Object.keys(content).find((k) => /json/i.test(k)) ?? Object.keys(content).find((k) => k === "*/*");
  const media = key ? content[key] : undefined;
  return isObj(media) ? media.schema : undefined;
}

export type OpenApiRequest = { method?: string; path?: string };

export function parseOpenApi(input: unknown, req: OpenApiRequest = {}): ParseOutcome {
  if (!isObj(input)) return { ok: false, message: "That is not an OpenAPI or Swagger file." };
  const v2 = typeof input.swagger === "string" && input.swagger.startsWith("2");
  const v3 = typeof input.openapi === "string" && /^3\./.test(input.openapi);
  if (!v2 && !v3) return { ok: false, message: "That is not an OpenAPI 3 or Swagger 2 file." };
  const w = new Walker(input);
  const all = operationsOf(input);
  if (!all.length) return { ok: false, message: "The file lists no operations." };

  const withBody = all.filter((o) => bodySchemaOf(w, input, o.op, o.pathItem, v2) !== undefined);
  const summary = (o: { method: string; path: string; op: Json }): SchemaOperation => ({
    method: o.method, path: o.path, summary: String(o.op.summary ?? o.op.operationId ?? "").slice(0, 120),
  });
  let chosen = all.find((o) => req.method && req.path && o.method === req.method.toUpperCase() && o.path === req.path)
    ?? all.find((o) => req.method && req.path && o.method === req.method.toUpperCase() && pathMatches(o.path, req.path));
  if (!chosen) {
    if (req.method || req.path) return { ok: false, message: "No operation in the file matches that method and path. Pick one from the list.", operations: withBody.map(summary).slice(0, 300) };
    if (withBody.length === 1) chosen = withBody[0];
    else return { ok: false, message: "Pick the operation whose request you want to fill.", operations: withBody.map(summary).slice(0, 300) };
  }
  const raw = bodySchemaOf(w, input, chosen.op, chosen.pathItem, v2);
  if (raw === undefined) return { ok: false, message: `${chosen.method} ${chosen.path} takes no request body. Pick an operation that creates or updates something.`, operations: withBody.map(summary).slice(0, 300) };

  const refKey = isObj(raw) && typeof raw.$ref === "string" ? raw.$ref : null;
  const schema = w.effective(raw, []);
  const flat: Flat = { fields: [], lines: null };
  if (fieldType(schema) === "array") return { ok: false, message: "This operation takes a list at the top. Pick an operation that takes one document." };
  flatten(w, schema, "", true, refKey ? [refKey] : [], 0, true, flat);
  if (!flat.fields.length && !flat.lines) return { ok: false, message: "The request body of that operation lists no fields." };

  let lineFields: TargetField[] = [];
  let linesPath: string | null = null;
  if (flat.lines) {
    const inner: Flat = { fields: [], lines: null };
    flatten(w, flat.lines.items, "", true, refKey ? [refKey] : [], 0, false, inner);
    lineFields = inner.fields;
    linesPath = flat.lines.name;
  }
  const notes = w.notes;
  return {
    ok: true, entity: `${chosen.method} ${chosen.path}`, operation: { method: chosen.method, path: chosen.path },
    fields: sortFields(capFields(flat.fields, LIMITS.fieldsPerBlock, "header", notes)),
    lineFields: sortFields(capFields(lineFields, LIMITS.fieldsPerBlock, "lines", notes)),
    linesPath, notes,
  };
}
