import { RESPONSE_PATH_RE } from "./validate";

// `$.data.number`, `$.items[0].id`: the readable id of the document a receiver created, read from its answer. A literal path
// of names and indexes, never an expression, and a name can never reach a prototype. Pure.

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

export function readResponsePath(body: unknown, path: string | null | undefined): string | null {
  if (!path || !RESPONSE_PATH_RE.test(path)) return null;
  let cur: unknown = body;
  for (const m of path.slice(1).matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g)) {
    if (cur === null || typeof cur !== "object") return null;
    if (m[1] !== undefined) {
      if (UNSAFE.has(m[1]) || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, m[1])) return null;
      cur = (cur as Record<string, unknown>)[m[1]];
    } else {
      if (!Array.isArray(cur)) return null;
      cur = cur[Number(m[2])];
    }
  }
  if (typeof cur === "string") return cur.trim().slice(0, 200) || null;
  if (typeof cur === "number" && Number.isFinite(cur)) return String(cur);
  return null;
}
