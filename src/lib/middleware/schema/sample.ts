import { FIELD_TYPES, type FieldType, type TargetField } from "../mapping/types";
import { LIMITS, UNSAFE_KEYS, capFields, humanize, sortFields, type ParseOutcome } from "./types";

// A pasted sample (the JSON body of a request, or one row of a response) and a hand-typed field list: the two ways in when
// the other system publishes no schema. Types are read from the values; nothing is required, because a sample cannot say.

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function typeOf(v: unknown): FieldType {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "date";
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) return "datetime";
    return "text";
  }
  if (Array.isArray(v)) return "array";
  return v !== null && typeof v === "object" ? "object" : "text";
}

type Flat = { fields: TargetField[]; lines: { name: string; row: Record<string, unknown> } | null };

function walk(o: Record<string, unknown>, prefix: string, depth: number, top: boolean, out: Flat, notes: string[]): void {
  if (depth > LIMITS.sample.depth) { notes.push("Deeply nested objects were cut."); return; }
  for (const k of Object.keys(o)) {
    if (UNSAFE_KEYS.has(k) || k === "" || k.startsWith("@odata") || k.includes("@odata")) continue;
    const v = o[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) { walk(v, path, depth + 1, false, out, notes); continue; }
    if (Array.isArray(v)) {
      const first = v.find(isObj);
      if (top && !out.lines && first) { out.lines = { name: k, row: first }; continue; }
      out.fields.push({ path, label: humanize(k), type: "array", required: false, creatable: true });
      continue;
    }
    out.fields.push({ path, label: humanize(k), type: typeOf(v), required: false, creatable: true });
  }
}

export function parseSample(text: string): ParseOutcome {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Paste a sample first." };
  if (text.length > LIMITS.sample.bytes) return { ok: false, message: "That sample is longer than 64 KB. Paste one record." };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: "That is not valid JSON. Paste the body of one request or one record." };
  }
  const notes: string[] = [];
  // A list of records, or an OData answer ({ value: [...] }): the first record stands for the rest.
  let row: unknown = json;
  if (Array.isArray(row)) { row = row.find(isObj); notes.push("The first record of the list was used."); }
  else if (isObj(row) && Array.isArray(row.value) && Object.keys(row).every((k) => k === "value" || k.startsWith("@") || k.includes("@odata"))) { row = row.value.find(isObj); notes.push("The first record of the list was used."); }
  if (!isObj(row)) return { ok: false, message: "The sample must be a JSON object (one record), or a list of them." };
  const flat: Flat = { fields: [], lines: null };
  walk(row, "", 0, true, flat, notes);
  if (!flat.fields.length && !flat.lines) return { ok: false, message: "The sample has no fields." };
  let lineFields: TargetField[] = [];
  let linesPath: string | null = null;
  if (flat.lines) {
    const inner: Flat = { fields: [], lines: null };
    walk(flat.lines.row, "", 1, false, inner, notes);
    lineFields = inner.fields;
    linesPath = flat.lines.name;
  }
  return {
    ok: true, entity: "Sample", fields: sortFields(capFields(flat.fields, LIMITS.fieldsPerBlock, "header", notes)),
    lineFields: sortFields(capFields(lineFields, LIMITS.fieldsPerBlock, "lines", notes)), linesPath, notes,
  };
}

// ── Added by hand ────────────────────────────────────────────────────────────

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:[.@][A-Za-z0-9_]+)*$/;

export function parseManualFields(raw: unknown, linesPath?: unknown): { ok: true; fields: TargetField[]; lineFields: TargetField[]; linesPath: string | null } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "Send the fields as a list." };
  if (raw.length === 0) return { ok: false, message: "Add at least one field." };
  if (raw.length > LIMITS.manualFields) return { ok: false, message: `Add at most ${LIMITS.manualFields} fields by hand.` };
  const fields: TargetField[] = [];
  const lineFields: TargetField[] = [];
  const seen = new Set<string>();
  let lp: string | null = null;
  if (linesPath !== undefined && linesPath !== null && linesPath !== "") {
    if (typeof linesPath !== "string" || !PATH_RE.test(linesPath) || UNSAFE_KEYS.has(linesPath)) return { ok: false, message: "The lines block name is not valid." };
    lp = linesPath;
  }
  for (const f of raw) {
    if (!isObj(f)) return { ok: false, message: "Each field has a path and a type." };
    const path = typeof f.path === "string" ? f.path.trim() : "";
    if (!PATH_RE.test(path) || path.length > 120 || path.split(".").some((s) => UNSAFE_KEYS.has(s))) return { ok: false, message: `"${path.slice(0, 40)}" is not a field name: letters, digits, underscore and dots.` };
    const type = f.type === undefined ? "text" : f.type;
    if (typeof type !== "string" || !(FIELD_TYPES as readonly string[]).includes(type)) return { ok: false, message: `${path}: choose a type: ${FIELD_TYPES.join(", ")}.` };
    const inLines = f.block === "lines";
    if (inLines && !lp) return { ok: false, message: `${path}: name the lines block first.` };
    const key = `${inLines ? "l" : "h"}:${path}`;
    if (seen.has(key)) return { ok: false, message: `${path} is listed twice.` };
    seen.add(key);
    const label = typeof f.label === "string" && f.label.trim() ? f.label.trim().slice(0, 80) : humanize(path.split(".").pop() ?? path);
    const field: TargetField = { path, label, type: type as FieldType, required: f.required === true, creatable: true };
    if (type === "enum" && Array.isArray(f.enum)) field.enum = f.enum.filter((x): x is string => typeof x === "string").slice(0, 500);
    (inLines ? lineFields : fields).push(field);
  }
  if (!fields.length && !lineFields.length) return { ok: false, message: "Add at least one field." };
  return { ok: true, fields: sortFields(fields), lineFields: sortFields(lineFields), linesPath: lp };
}
