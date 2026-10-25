// Validation of the per-workspace endpoint map. The map is typed by an admin and later steers what OUR server sends to
// a host they named, so it is cleaned on every save: relative paths only (the credential can never be sent to another
// address by a path), known operations only, placeholders that exist, JSON paths that parse.

import { isValidPath, placeholdersOf } from "./jsonPath";
import {
  EPROMIS_OPERATIONS, EPROMIS_OPERATION_LABEL, HTTP_METHODS, LINE_PLACEHOLDERS, MASTER_FIELDS, OPERATION_PLACEHOLDERS, PROJECT_READ_FIELDS,
  type EndpointDef, type EndpointMap, type EpromisOperation, type HttpMethod,
} from "./types";

export const DEFAULT_METHOD: Record<EpromisOperation, HttpMethod> = {
  ping: "GET", list_tenders: "GET", get_project: "GET", create_project: "POST", create_budget: "POST", replace_budget: "PUT",
  list_resources: "GET", list_cost_codes: "GET", list_justifications: "GET",
};

const LIST_OPS: readonly EpromisOperation[] = ["list_tenders", "list_resources", "list_cost_codes", "list_justifications"];
const BUDGET_OPS: readonly EpromisOperation[] = ["create_budget", "replace_budget"];
const WRITE_OPS: readonly EpromisOperation[] = ["create_project", ...BUDGET_OPS];
export const isListOp = (op: EpromisOperation): boolean => LIST_OPS.includes(op);
export const isWriteOp = (op: EpromisOperation): boolean => WRITE_OPS.includes(op);

const MAX_ENTRIES = 40;
const MAX_VALUE = 200;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export class EndpointMapProblem extends Error {}

function bad(op: EpromisOperation, what: string): never {
  throw new EndpointMapProblem(`${EPROMIS_OPERATION_LABEL[op]}: ${what}`);
}

function cleanPath(op: EpromisOperation, raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") bad(op, "the path must be text.");
  const p = raw.trim();
  if (!p) return undefined;
  if (p.length > 300) bad(op, "the path is too long.");
  if (!p.startsWith("/") || p.startsWith("//")) bad(op, "the path must start with a single / and is relative to the base URL.");
  if (/[\s\\]|:\/\/|\.\.|[\u0000-\u001f]/.test(p)) bad(op, "the path may not contain spaces, a backslash, .. or a full address.");
  for (const name of placeholdersOf(p)) {
    if (!OPERATION_PLACEHOLDERS[op].includes(name)) bad(op, `{${name}} is not available in the path. Use: ${OPERATION_PLACEHOLDERS[op].map((n) => `{${n}}`).join(", ") || "no placeholders"}.`);
  }
  return p;
}

function cleanJsonPath(op: EpromisOperation, label: string, raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !isValidPath(raw)) bad(op, `${label} is not a valid path (use names, dots and [0], such as data.items).`);
  return raw.trim();
}

function cleanRecord(
  op: EpromisOperation, label: string, raw: unknown,
  rule: { key: (k: string) => boolean; keyHelp: string; value: "path" | { placeholders: readonly string[] } },
): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) bad(op, `${label} must be a list of name and value pairs.`);
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_ENTRIES) bad(op, `${label} has more than ${MAX_ENTRIES} entries.`);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!rule.key(k)) bad(op, `${label}: "${k}" is not allowed here. ${rule.keyHelp}`);
    if (typeof v !== "string") bad(op, `${label}: the value for "${k}" must be text.`);
    const t = v.trim();
    if (!t) continue;
    if (t.length > MAX_VALUE) bad(op, `${label}: the value for "${k}" is too long.`);
    if (rule.value === "path") {
      if (!isValidPath(t)) bad(op, `${label}: "${t}" is not a valid path.`);
    } else {
      for (const name of placeholdersOf(t)) {
        if (!rule.value.placeholders.includes(name)) bad(op, `${label}: {${name}} is not available. Use: ${rule.value.placeholders.map((n) => `{${n}}`).join(", ")}.`);
      }
    }
    out[k] = t;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanDef(op: EpromisOperation, raw: unknown): EndpointDef | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) bad(op, "must be an object.");
  const r = raw as Record<string, unknown>;
  const known = new Set(["path", "method", "rows_path", "next_path", "fields", "flags", "body", "lines_path", "line", "id_path"]);
  for (const k of Object.keys(r)) if (!known.has(k)) bad(op, `"${k}" is not a setting of an operation.`);

  const def: EndpointDef = {};
  const path = cleanPath(op, r.path);
  if (path) def.path = path;
  if (r.method !== undefined && r.method !== null && r.method !== "") {
    const m = String(r.method).toUpperCase();
    if (!(HTTP_METHODS as readonly string[]).includes(m)) bad(op, `the method must be one of ${HTTP_METHODS.join(", ")}.`);
    def.method = m as HttpMethod;
  }
  const isList = isListOp(op);
  if (isList || op === "get_project") {
    const rows = cleanJsonPath(op, "rows_path", r.rows_path); if (rows) def.rows_path = rows;
  } else if (r.rows_path) bad(op, "rows_path belongs to reads only.");
  if (isList) {
    const next = cleanJsonPath(op, "next_path", r.next_path); if (next) def.next_path = next;
  } else if (r.next_path) bad(op, "next_path belongs to lists only.");

  if (isList || op === "get_project") {
    const allowed: readonly string[] = op === "get_project" ? PROJECT_READ_FIELDS : MASTER_FIELDS;
    const fields = cleanRecord(op, "fields", r.fields, { key: (k) => allowed.includes(k), keyHelp: `Use: ${allowed.join(", ")}.`, value: "path" });
    if (fields) def.fields = fields;
    const flags = cleanRecord(op, "flags", r.flags, { key: (k) => NAME_RE.test(k), keyHelp: "A flag name is letters, digits and _.", value: "path" });
    if (flags) def.flags = flags;
  } else if (r.fields || r.flags) bad(op, "fields and flags belong to reads only.");

  if (isWriteOp(op)) {
    const body = cleanRecord(op, "body", r.body, { key: (k) => isValidPath(k) && k.trim() !== "" && k.trim() !== "$", keyHelp: "It must be a path in the request body.", value: { placeholders: OPERATION_PLACEHOLDERS[op] } });
    if (body) def.body = body;
    const id = cleanJsonPath(op, "id_path", r.id_path); if (id) def.id_path = id;
  } else if (r.body || r.id_path) bad(op, "body and id_path belong to writes only.");

  if (BUDGET_OPS.includes(op)) {
    const lp = cleanJsonPath(op, "lines_path", r.lines_path); if (lp) def.lines_path = lp;
    const line = cleanRecord(op, "line", r.line, { key: (k) => isValidPath(k) && k.trim() !== "" && k.trim() !== "$", keyHelp: "It must be a path inside one line.", value: { placeholders: LINE_PLACEHOLDERS } });
    if (line) def.line = line;
  } else if (r.lines_path || r.line) bad(op, "lines_path and line belong to budget writes only.");

  // A method alone says nothing (every operation has a default one), so it is not kept.
  const keys = Object.keys(def);
  return keys.length === 0 || (keys.length === 1 && keys[0] === "method") ? null : def;
}

/** The map as it will be stored, or the first problem in words. Empty entries are dropped. */
export function cleanEndpointMap(raw: unknown): { map: EndpointMap; problem: string | null } {
  if (raw === undefined || raw === null || raw === "") return { map: {}, problem: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { map: {}, problem: "The endpoint map must be an object with one entry per operation." };
  const src = raw as Record<string, unknown>;
  const map: EndpointMap = {};
  try {
    for (const key of Object.keys(src)) {
      if (!(EPROMIS_OPERATIONS as readonly string[]).includes(key)) {
        throw new EndpointMapProblem(`"${key}" is not an operation. Use: ${EPROMIS_OPERATIONS.join(", ")}.`);
      }
    }
    for (const op of EPROMIS_OPERATIONS) {
      const def = cleanDef(op, src[op]);
      if (def) map[op] = def;
    }
  } catch (e) {
    if (e instanceof EndpointMapProblem) return { map: {}, problem: e.message };
    throw e;
  }
  return { map, problem: null };
}

/** Operations that have a path, for the "what is set" line on the settings page. */
export const configuredOperations = (map: EndpointMap): EpromisOperation[] => EPROMIS_OPERATIONS.filter((op) => !!map[op]?.path);
