import type { FieldType, TargetField } from "../mapping/types";

// What every schema parser returns (spec section 2): the fields of the header block and of the one lines block, in the one
// TargetField shape. Pure; no I/O.

export const LIMITS = {
  openapi: { bytes: 5 * 1024 * 1024, ms: 20_000 },
  odata: { bytes: 10 * 1024 * 1024, ms: 30_000 },
  sample: { bytes: 64 * 1024, depth: 6 },
  fieldsPerBlock: 500,
  manualFields: 200,
  refDepth: 6,
} as const;

export type SchemaOperation = { method: string; path: string; summary: string };

export type ParsedSchema = {
  entity: string;
  fields: TargetField[];
  lineFields: TargetField[];
  linesPath: string | null;
  operation?: { method: string; path: string };
  /** Plain remarks for the person: "the first of three options was used", "list cut at 500 fields". */
  notes: string[];
};

export type ParseOutcome = ({ ok: true } & ParsedSchema) | { ok: false; message: string; operations?: SchemaOperation[] };

export const SCHEMA_HINT = "No field list yet: fetch one, paste a sample, or add fields.";

export const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const humanize = (k: string): string =>
  k.replace(/@odata\.bind$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

export const sortFields = (fields: TargetField[]): TargetField[] =>
  [...fields].sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label) || a.path.localeCompare(b.path));

/** Keep at most `n` fields per block, required first, and say so. */
export function capFields(fields: TargetField[], n: number, block: string, notes: string[]): TargetField[] {
  if (fields.length <= n) return fields;
  notes.push(`The ${block} list was cut at ${n} of ${fields.length} fields (required ones first). Pick a more specific operation to see the rest.`);
  return sortFields(fields).slice(0, n);
}

export const isFieldType = (v: unknown): v is FieldType => typeof v === "string" && ["text", "integer", "number", "boolean", "date", "datetime", "enum", "lookup", "array", "object"].includes(v);

// ── Refresh: what is new, what is gone ───────────────────────────────────────

/**
 * Mark the new list against the snapshot it replaces. A field not seen before is `new`; a field the mapping uses that the
 * target no longer has is kept and marked `missing`. Nothing is dropped silently.
 */
export function diffSchema(previous: TargetField[], next: TargetField[], mapped: ReadonlySet<string>): { fields: TargetField[]; counts: { total: number; new: number; missing: number } } {
  const before = new Map(previous.map((f) => [f.path, f]));
  const now = new Set(next.map((f) => f.path));
  const fields: TargetField[] = next.map((f) => {
    const { state: _s, ...rest } = f;
    void _s;
    return previous.length && !before.has(f.path) ? { ...rest, state: "new" as const } : rest;
  });
  for (const f of previous) {
    if (now.has(f.path)) continue;
    if (mapped.has(f.path)) fields.push({ ...f, state: "missing" });
  }
  return {
    fields,
    counts: { total: fields.filter((f) => f.state !== "missing").length, new: fields.filter((f) => f.state === "new").length, missing: fields.filter((f) => f.state === "missing").length },
  };
}

export function countFields(fields: TargetField[], lineFields: TargetField[] = []): { total: number; new: number; missing: number } {
  const all = [...fields, ...lineFields];
  return { total: all.filter((f) => f.state !== "missing").length, new: all.filter((f) => f.state === "new").length, missing: all.filter((f) => f.state === "missing").length };
}
