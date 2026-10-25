// The only path language the ePROMIS endpoint map speaks: dotted names and [n] indexes, with an optional leading "$".
// `data.items`, `$.rows[0].code`, `result`. No wildcards or filters: a vendor answer that needs more is shaped by the
// operation (rows_path plus fields), not by a richer path.

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
export const MAX_PATH_DEPTH = 8;
export const MAX_PATH_LENGTH = 120;

export type PathSegment = string | number;

/** The segments of a path, or null when it is not a valid one. "" and "$" are the empty path (the value itself). */
export function parsePath(raw: string): PathSegment[] | null {
  const p = raw.trim().replace(/^\$\.?/, "");
  if (p === "") return [];
  if (p.length > MAX_PATH_LENGTH) return null;
  const out: PathSegment[] = [];
  for (const part of p.split(".")) {
    const m = /^([A-Za-z0-9_$@-]*)((?:\[\d{1,6}\])*)$/.exec(part);
    if (!m || (!m[1] && !m[2])) return null;
    if (m[1]) {
      if (FORBIDDEN.has(m[1])) return null;
      out.push(m[1]);
    }
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out.length <= MAX_PATH_DEPTH ? out : null;
}

export const isValidPath = (raw: string): boolean => parsePath(raw) !== null;

/** The value at `path`, or undefined. Never throws, never reads an inherited property. */
export function getPath(value: unknown, path: string | PathSegment[]): unknown {
  const segs = typeof path === "string" ? parsePath(path) : path;
  if (!segs) return undefined;
  let cur: unknown = value;
  for (const seg of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/** Set `value` at `path` inside `target`, creating objects and arrays on the way. A bad path is ignored (false). */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): boolean {
  const segs = parsePath(path);
  if (!segs || segs.length === 0) return false;
  let cur: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const container = cur as Record<string | number, unknown>;
    if (last) { container[seg] = value; return true; }
    const next = segs[i + 1];
    let child = container[seg];
    if (child === null || typeof child !== "object") {
      child = typeof next === "number" ? [] : {};
      container[seg] = child;
    }
    cur = child as Record<string, unknown> | unknown[];
  }
  return true;
}

/** The placeholder names ({name}) a template mentions, in order. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
}

/**
 * A template against values. A template that is exactly one placeholder keeps the value's type (a number stays a
 * number); a mix of text and placeholders becomes a string; a missing value makes the whole result undefined so the
 * key is left out of the body rather than sent as "null" text.
 */
export function applyTemplate(template: string, values: Record<string, unknown>): unknown {
  const names = placeholdersOf(template);
  if (names.length === 0) return template;
  const only = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(template);
  if (only) {
    const v = values[only[1]];
    return v === null || v === undefined ? undefined : v;
  }
  let missing = false;
  const s = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, n: string) => {
    const v = values[n];
    if (v === null || v === undefined) { missing = true; return ""; }
    return String(v);
  });
  return missing ? undefined : s;
}
