import {
  PRIMARY_ALIAS, readPath, recordFields, resolveToken, scanTokens, soleToken,
  type CallObject, type RenderContext,
} from "./tokens";

// Validation and rendering of a Call webhook's payload and address. Pure.
//
// JSON-first: a template must parse as JSON BEFORE any value is substituted, and the
// tokens live inside string values. Substitution then edits the parsed tree and the
// body is produced by JSON.stringify, so a value holding a quote, a backslash or a
// brace can never break the structure or inject a key -- whatever a record contains,
// the result is valid JSON. A substituted value is never scanned again for tokens.

export const MAX_TEMPLATE_BYTES = 16 * 1024;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_URL_CHARS = 2048;

export type FieldError = { field: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Check every token in one string against the whitelist; returns the problems. */
function checkString(s: string, objectType: CallObject, allowPii: boolean, where: string, field: string, errors: FieldError[]): void {
  const scan = scanTokens(s);
  if (scan.stray) errors.push({ field, message: `${where}: a "{{" or "}}" is not part of a token. Write tokens as {{account.name}}.` });
  for (const name of scan.names) {
    const spec = resolveToken(objectType, name);
    if (!spec) errors.push({ field, message: `${where}: {{${name}}} is not a known token.` });
    else if (spec.pii && !allowPii) errors.push({ field, message: `${where}: {{${name}}} is personal data. Switch on "Allow personal data" to use it.` });
  }
}

function walkTemplate(node: unknown, objectType: CallObject, allowPii: boolean, path: string, errors: FieldError[]): void {
  if (typeof node === "string") return checkString(node, objectType, allowPii, path || "template", "template", errors);
  if (Array.isArray(node)) return node.forEach((x, i) => walkTemplate(x, objectType, allowPii, `${path}[${i}]`, errors));
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.includes("{{") || k.includes("}}")) errors.push({ field: "template", message: `${path ? `${path}.` : ""}${k}: tokens go in values, not in names.` });
      walkTemplate(v, objectType, allowPii, path ? `${path}.${k}` : k, errors);
    }
  }
}

/** The parsed template when it is valid JSON of at most 16 KB with only known tokens (and personal data only if allowed). */
export function validateTemplate(source: string, objectType: CallObject, allowPii: boolean): Validated<unknown> {
  if (bytes(source) > MAX_TEMPLATE_BYTES) return { ok: false, errors: [{ field: "template", message: "The template is larger than 16 KB." }] };
  let tree: unknown;
  try {
    tree = JSON.parse(source);
  } catch {
    return { ok: false, errors: [{ field: "template", message: "The template must be valid JSON. Put tokens inside quoted values." }] };
  }
  const errors: FieldError[] = [];
  walkTemplate(tree, objectType, allowPii, "", errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: tree };
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

function renderString(s: string, ctx: RenderContext): unknown {
  const sole = soleToken(s);
  if (sole !== null) {
    const v = readPath(ctx, sole);
    return v === undefined ? null : v;
  }
  return s.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_m, name: string) => text(readPath(ctx, name)));
}

function renderNode(node: unknown, ctx: RenderContext): unknown {
  if (typeof node === "string") return renderString(node, ctx);
  if (Array.isArray(node)) return node.map((x) => renderNode(x, ctx));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = renderNode(v, ctx);
    return out;
  }
  return node;
}

export type RenderedBody = { ok: true; value: unknown; json: string } | { ok: false; message: string };

function sized(value: unknown): RenderedBody {
  const json = JSON.stringify(value);
  if (bytes(json) > MAX_BODY_BYTES) return { ok: false, message: "The payload is too large." };
  return { ok: true, value, json };
}

/** A parsed (already validated) template, filled from the context. */
export function renderTemplate(tree: unknown, ctx: RenderContext): RenderedBody {
  return sized(renderNode(tree, ctx));
}

/** Set `value` at a nested path, creating objects on the way. */
function setDeep(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = target;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (!next || typeof next !== "object") cur[path[i]] = {};
    cur = cur[path[i]] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/** The record of the standard body: the object's whitelisted fields (personal data only when allowed), its custom fields and ERP numbers. */
export function standardRecord(objectType: CallObject, ctx: RenderContext, allowPii: boolean): Record<string, unknown> {
  const primary = PRIMARY_ALIAS[objectType];
  const rec: Record<string, unknown> = { id: ctx.record.id, url: ctx.record.url };
  for (const f of recordFields(objectType)) {
    if (f.pii && !allowPii) continue;
    const parts = f.path.split(".");
    const rel = parts[0] === primary ? parts.slice(1) : ["account", ...parts.slice(1)];
    if (rel.length === 1 && rel[0] === "id") continue;
    const v = readPath(ctx, f.path);
    setDeep(rec, rel, v === undefined ? null : v);
  }
  if (objectType === "accounts") {
    const custom = ctx.account?.custom;
    if (custom && typeof custom === "object") rec.custom = custom;
  } else {
    const ext = ctx.quote?.external;
    if (ext && typeof ext === "object") rec.external = ext;
  }
  return rec;
}

/** `{ event, delivery_id, sent_at, workspace, record }` -- the signed body every receiver already knows. */
export function renderStandard(objectType: CallObject, ctx: RenderContext, allowPii: boolean): RenderedBody {
  return sized({
    event: ctx.event, delivery_id: ctx.delivery_id, sent_at: ctx.sent_at, workspace: ctx.workspace.name,
    record: standardRecord(objectType, ctx, allowPii),
  });
}

// ── the address ──────────────────────────────────────────────────────────────

/** A well-formed, https address whose tokens are only in the path and query, scalar and not personal data.
 *  Returns the address with each token replaced by `x`, to run the host checks on. */
export function validateUrlTemplate(raw: string, objectType: CallObject | null): Validated<{ sample: string }> {
  const url = raw.trim();
  const errors: FieldError[] = [];
  if (!url) return { ok: false, errors: [{ field: "url", message: "The address is required." }] };
  if (url.length > MAX_URL_CHARS) return { ok: false, errors: [{ field: "url", message: "The address is too long." }] };
  const m = /^https:\/\/([^/?#]*)/i.exec(url);
  if (!m) return { ok: false, errors: [{ field: "url", message: /^http:\/\//i.test(url) ? "The address must use https." : "The address must start with https://." }] };
  if (m[1].includes("{{") || m[1].includes("}}")) errors.push({ field: "url", message: "Tokens can go in the path or the query, not in the host." });
  const scan = scanTokens(url);
  if (scan.stray) errors.push({ field: "url", message: 'A "{{" or "}}" in the address is not part of a token.' });
  if (scan.names.length && !objectType) errors.push({ field: "url", message: "Tokens in the address need a call webhook for one object." });
  for (const name of scan.names) {
    const spec = objectType ? resolveToken(objectType, name) : null;
    if (!spec) { if (objectType) errors.push({ field: "url", message: `{{${name}}} is not a known token.` }); }
    else if (spec.pii) errors.push({ field: "url", message: `{{${name}}} is personal data and cannot go in the address.` });
    else if (spec.kind === "array" || spec.kind === "object") errors.push({ field: "url", message: `{{${name}}} is a list and cannot go in the address.` });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { sample: url.replace(/\{\{[^{}]*\}\}/g, "x") } };
}

/** The address with each token URL-encoded into place. Throws on a personal-data token: the check is repeated at send time. */
export function renderUrl(template: string, objectType: CallObject, ctx: RenderContext): string {
  return template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_m, name: string) => {
    const spec = resolveToken(objectType, name);
    if (!spec || spec.pii || spec.kind === "array" || spec.kind === "object") throw new Error(`{{${name}}} cannot be used in the address.`);
    return encodeURIComponent(text(readPath(ctx, name)));
  });
}
