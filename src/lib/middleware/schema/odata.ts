import type { FieldType, TargetField } from "../mapping/types";
import { LIMITS, UNSAFE_KEYS, capFields, humanize, sortFields, type ParseOutcome, type SchemaOperation } from "./types";

// An OData `$metadata` document (v2 and v4: SAP Gateway, Finance and Operations, Business Central) -> the properties of
// one entity set as a field list, plus the collection navigation that holds the lines. Scanned with anchored expressions
// instead of building a tree (F&O's document is megabytes), and it never resolves an external reference.

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[:.]/g, "\\$&")}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos);/g, (_m, c: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[c]);
}

const short = (t: string) => t.replace(/^Collection\(/, "").replace(/\)$/, "").split(".").pop() ?? t;

type Block = { name: string; body: string; tag: string };

function blocks(xml: string, element: string): Block[] {
  const out: Block[] = [];
  const re = new RegExp(`<${element}\\b([^>]*?)(/>|>)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const name = attr(m[1], "Name");
    if (!name) continue;
    if (m[2] === "/>") { out.push({ name, body: "", tag: m[1] }); continue; }
    const end = xml.indexOf(`</${element}>`, re.lastIndex);
    if (end < 0) break;
    out.push({ name, body: xml.slice(re.lastIndex, end), tag: m[1] });
    re.lastIndex = end;
    if (out.length > 5000) break;
  }
  return out;
}

const EDM: Record<string, FieldType> = {
  String: "text", Guid: "text", Binary: "text", Stream: "text",
  Byte: "integer", SByte: "integer", Int16: "integer", Int32: "integer", Int64: "integer",
  Decimal: "number", Double: "number", Single: "number",
  Boolean: "boolean", Date: "date", DateTime: "datetime", DateTimeOffset: "datetime", TimeOfDay: "text", Duration: "text",
};

class Doc {
  entities: Map<string, Block>;
  complex: Map<string, Block>;
  enums: Map<string, string[]>;
  sets: Block[];
  constructor(public xml: string) {
    this.entities = new Map(blocks(xml, "EntityType").map((b) => [b.name, b]));
    this.complex = new Map(blocks(xml, "ComplexType").map((b) => [b.name, b]));
    this.enums = new Map(blocks(xml, "EnumType").map((b) => [b.name, [...b.body.matchAll(/<Member\b[^>]*>/gi)].map((m) => attr(m[0], "Name")).filter((n): n is string => !!n && !n.startsWith("_x")).slice(0, 500)]));
    this.sets = blocks(xml, "EntitySet");
  }

  properties(typeName: string, prefix: string, depth: number, notes: string[]): TargetField[] {
    const block = this.entities.get(typeName) ?? this.complex.get(typeName);
    if (!block) return [];
    const keys = new Set([...block.body.matchAll(/<PropertyRef\b[^>]*>/gi)].map((m) => attr(m[0], "Name")).filter((n): n is string => !!n));
    const out: TargetField[] = [];
    for (const m of block.body.matchAll(/<Property\b[^>]*>/gi)) {
      const name = attr(m[0], "Name");
      if (!name || UNSAFE_KEYS.has(name)) continue;
      const rawType = attr(m[0], "Type") ?? "Edm.String";
      const path = prefix ? `${prefix}.${name}` : name;
      const label = attr(m[0], "sap:label") ?? humanize(name);
      const required = attr(m[0], "Nullable") === "false" || keys.has(name);
      const creatable = attr(m[0], "sap:creatable") !== "false";
      if (rawType.startsWith("Collection(")) { out.push({ path, label, type: "array", required: false, creatable }); continue; }
      const t = short(rawType);
      if (rawType.startsWith("Edm.")) {
        out.push({ path, label, type: EDM[t] ?? "text", required, creatable });
      } else if (this.enums.has(t)) {
        out.push({ path, label, type: "enum", required, creatable, enum: this.enums.get(t)! });
      } else if (this.complex.has(t)) {
        if (depth >= 3) { notes.push("Deeply nested structures were cut."); continue; }
        out.push(...this.properties(t, path, depth + 1, notes).map((f) => ({ ...f, required: f.required && required })));
      } else {
        out.push({ path, label, type: "text", required, creatable });
      }
    }
    return out;
  }

  /** Collection navigation properties of an entity type: the candidates for the lines block. */
  collections(typeName: string): { name: string; type: string }[] {
    const block = this.entities.get(typeName);
    if (!block) return [];
    const out: { name: string; type: string }[] = [];
    for (const m of block.body.matchAll(/<NavigationProperty\b[^>]*>/gi)) {
      const name = attr(m[0], "Name");
      const t = attr(m[0], "Type");
      if (name && t && t.startsWith("Collection(") && !UNSAFE_KEYS.has(name)) out.push({ name, type: short(t) });
    }
    return out;
  }
}

export type ODataRequest = { entitySet?: string };

export function listEntitySets(xml: string): SchemaOperation[] {
  const d = new Doc(xml);
  return d.sets.map((s) => ({ method: "POST", path: `/${s.name}`, summary: short(attr(s.tag, "EntityType") ?? "") })).sort((a, b) => a.path.localeCompare(b.path)).slice(0, 1000);
}

export function parseODataSchema(xml: string, req: ODataRequest = {}): ParseOutcome {
  const looksLikeEdm = typeof xml === "string" && (/<(edmx:)?Edmx\b|<Schema\b/i.test(xml.slice(0, 5000)) || /<EntityType\b/i.test(xml.slice(0, 200_000)));
  if (!looksLikeEdm) return { ok: false, message: "That is not an OData $metadata document." };
  const d = new Doc(xml);
  if (!d.sets.length) return { ok: false, message: "The $metadata lists no entity sets." };
  const wanted = req.entitySet?.replace(/^\//, "");
  if (!wanted) return { ok: false, message: "Pick the entity set to fill.", operations: listEntitySets(xml) };
  const set = d.sets.find((s) => s.name === wanted) ?? d.sets.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
  if (!set) return { ok: false, message: `The service has no entity set called ${wanted.slice(0, 60)}. Pick one from the list.`, operations: listEntitySets(xml) };
  const typeName = short(attr(set.tag, "EntityType") ?? "");
  if (!d.entities.has(typeName)) return { ok: false, message: `The entity type of ${set.name} is not in the document.` };

  const notes: string[] = [];
  const fields = d.properties(typeName, "", 0, notes);
  if (!fields.length) return { ok: false, message: `${set.name} lists no properties.` };

  let linesPath: string | null = null;
  let lineFields: TargetField[] = [];
  const cols = d.collections(typeName);
  const pick = cols.find((c) => /item|line|detail|position/i.test(c.name)) ?? cols[0];
  if (pick) {
    lineFields = d.properties(pick.type, "", 0, notes);
    if (lineFields.length) {
      linesPath = pick.name;
      if (cols.length > 1) notes.push(`${pick.name} is shown as the lines. The service also has: ${cols.filter((c) => c !== pick).map((c) => c.name).slice(0, 6).join(", ")}.`);
    }
  }
  return {
    ok: true, entity: set.name, operation: { method: "POST", path: `/${set.name}` },
    fields: sortFields(capFields(fields, LIMITS.fieldsPerBlock, "header", notes)),
    lineFields: sortFields(capFields(lineFields, LIMITS.fieldsPerBlock, "lines", notes)),
    linesPath, notes,
  };
}
