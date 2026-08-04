/**
 * Entity metadata for the public v1 API.
 *
 * One definition per entity drives three things that would otherwise drift
 * apart: the machine-readable metadata served at /api/v1/metadata, the
 * request validation every write endpoint runs, and the written docs. If a
 * field is added here it is documented, described and enforced in one edit.
 *
 * Deliberately not imported from fieldRegistry.ts: that describes how fields
 * are *rendered and customised per tenant* in the UI (labels a tenant can
 * rename, sections, hide/show rules). This describes the *API contract*,
 * which must stay stable across tenants and must not move when a tenant
 * renames a label.
 */

export type FieldType =
  | "string"
  | "text"
  | "richtext"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "uuid"
  | "uuid[]"
  | "enum"
  | "json";

export type FieldDef = {
  key: string;
  type: FieldType;
  label: string;
  description: string;
  /** Required when creating. Never required on update. */
  required?: boolean;
  /** Server-managed. Rejected if a caller tries to write it. */
  readOnly?: boolean;
  /** Derived server-side from other fields; rejected on write, present on read. */
  computed?: boolean;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  defaultValue?: unknown;
  /** Foreign key to another entity. */
  relation?: { entity: string; endpoint: string };
  example?: unknown;
};

export type ChildDef = {
  key: string;
  description: string;
  /** Max rows accepted in one request. */
  maxItems: number;
  entity: EntityDef;
};

export type EntityDef = {
  name: string;
  plural: string;
  table: string;
  description: string;
  endpoint: string;
  fields: FieldDef[];
  children?: ChildDef[];
};

// ── Validation ───────────────────────────────────────────────────────────────

export type ValidationError = { field: string; message: string };

export type ValidationResult<T> =
  | { ok: true; values: T }
  | { ok: false; errors: ValidationError[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerces one value to the field's type. Deliberately lenient about the
 * string/number boundary -- a caller posting `"12.5"` from Postman or a
 * spreadsheet export means the number 12.5, and rejecting that would make the
 * API annoying for exactly the bulk-load use case it exists for. Strict about
 * everything that carries meaning: enums, uuids, dates, ranges.
 */
function coerceField(f: FieldDef, raw: unknown): { value?: unknown; error?: string } {
  if (raw === null || raw === "") {
    if (f.required) return { error: `${f.key} is required and cannot be null` };
    return { value: null };
  }

  switch (f.type) {
    case "string":
    case "text":
    case "richtext": {
      const s = typeof raw === "string" ? raw : String(raw);
      if (f.maxLength && s.length > f.maxLength) {
        return { error: `must be at most ${f.maxLength} characters (got ${s.length})` };
      }
      return { value: s };
    }

    case "number":
    case "integer": {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) return { error: `must be a number (got ${JSON.stringify(raw)})` };
      if (f.type === "integer" && !Number.isInteger(n)) return { error: "must be a whole number" };
      if (f.min !== undefined && n < f.min) return { error: `must be >= ${f.min}` };
      if (f.max !== undefined && n > f.max) return { error: `must be <= ${f.max}` };
      return { value: n };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: "must be true or false" };
    }

    case "date": {
      const s = String(raw).slice(0, 10);
      if (!DATE_RE.test(s)) return { error: "must be a date in YYYY-MM-DD format" };
      if (Number.isNaN(new Date(s).getTime())) return { error: `is not a real date (${s})` };
      return { value: s };
    }

    case "datetime": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) return { error: "must be an ISO 8601 timestamp" };
      return { value: d.toISOString() };
    }

    case "uuid": {
      const s = String(raw);
      if (!UUID_RE.test(s)) return { error: `must be a UUID (got ${JSON.stringify(raw)})` };
      return { value: s };
    }

    case "uuid[]": {
      if (!Array.isArray(raw)) return { error: "must be an array of UUIDs" };
      for (const v of raw) {
        if (!UUID_RE.test(String(v))) return { error: `contains a value that is not a UUID: ${JSON.stringify(v)}` };
      }
      return { value: raw.map(String) };
    }

    case "enum": {
      const s = String(raw);
      if (!f.enumValues?.includes(s)) {
        return { error: `must be one of: ${(f.enumValues ?? []).join(", ")} (got ${JSON.stringify(raw)})` };
      }
      return { value: s };
    }

    case "json": {
      if (typeof raw !== "object" || Array.isArray(raw)) return { error: "must be a JSON object" };
      return { value: raw };
    }
  }
}

/**
 * Validates a request body against an entity definition.
 *
 * Unknown fields are an error rather than being silently dropped: a typo in a
 * bulk-load script should fail loudly on row 1, not silently discard a column
 * across ten thousand rows.
 */
export function validateBody(
  def: EntityDef,
  body: unknown,
  mode: "create" | "update"
): ValidationResult<Record<string, unknown>> {
  const errors: ValidationError[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "_body", message: "Request body must be a JSON object" }] };
  }
  const input = body as Record<string, unknown>;

  const byKey = new Map(def.fields.map((f) => [f.key, f]));
  const childKeys = new Set((def.children ?? []).map((c) => c.key));
  const values: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (childKeys.has(key)) continue; // children validated separately by the caller
    const f = byKey.get(key);
    if (!f) {
      const known = [...byKey.keys(), ...childKeys].sort().join(", ");
      errors.push({ field: key, message: `Unknown field. Accepted fields: ${known}` });
      continue;
    }
    if (f.readOnly || f.computed) {
      errors.push({
        field: key,
        message: f.computed
          ? "Read-only: this value is calculated by the server and cannot be set directly."
          : "Read-only: this value is managed by the server and cannot be set.",
      });
      continue;
    }
    const { value, error } = coerceField(f, raw);
    if (error) errors.push({ field: key, message: error });
    else values[key] = value;
  }

  if (mode === "create") {
    for (const f of def.fields) {
      if (!f.required || f.readOnly || f.computed) continue;
      if (values[f.key] === undefined || values[f.key] === null) {
        errors.push({ field: f.key, message: `${f.label} is required` });
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** Validates an array of child rows (e.g. quote lines). */
export function validateChildren(
  child: ChildDef,
  raw: unknown
): ValidationResult<Record<string, unknown>[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ field: child.key, message: "must be an array" }] };
  }
  if (raw.length > child.maxItems) {
    return {
      ok: false,
      errors: [{ field: child.key, message: `too many rows: ${raw.length} (maximum ${child.maxItems})` }],
    };
  }

  const errors: ValidationError[] = [];
  const rows: Record<string, unknown>[] = [];
  raw.forEach((row, i) => {
    const res = validateBody(child.entity, row, "create");
    if (res.ok) rows.push(res.values);
    else errors.push(...res.errors.map((e) => ({ field: `${child.key}[${i}].${e.field}`, message: e.message })));
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values: rows };
}

/** The JSON shape served by /api/v1/metadata/:entity. */
export function describeEntity(def: EntityDef): Record<string, unknown> {
  const describeField = (f: FieldDef) => ({
    field: f.key,
    type: f.type,
    label: f.label,
    description: f.description,
    required_on_create: !!f.required,
    writable: !f.readOnly && !f.computed,
    ...(f.computed ? { computed: true } : {}),
    ...(f.readOnly ? { read_only: true } : {}),
    ...(f.enumValues ? { allowed_values: f.enumValues } : {}),
    ...(f.min !== undefined ? { min: f.min } : {}),
    ...(f.max !== undefined ? { max: f.max } : {}),
    ...(f.maxLength !== undefined ? { max_length: f.maxLength } : {}),
    ...(f.defaultValue !== undefined ? { default: f.defaultValue } : {}),
    ...(f.relation ? { relation: f.relation } : {}),
    ...(f.example !== undefined ? { example: f.example } : {}),
  });

  return {
    entity: def.name,
    plural: def.plural,
    table: def.table,
    description: def.description,
    endpoint: def.endpoint,
    field_count: def.fields.length,
    fields: def.fields.map(describeField),
    children: (def.children ?? []).map((c) => ({
      key: c.key,
      description: c.description,
      max_items: c.maxItems,
      entity: c.entity.name,
      field_count: c.entity.fields.length,
      fields: c.entity.fields.map(describeField),
    })),
    relations: def.fields
      .filter((f) => f.relation)
      .map((f) => ({ field: f.key, entity: f.relation!.entity, endpoint: f.relation!.endpoint })),
  };
}
