// A rule can name its product by attributes instead of a SKU (docs/estimator-architecture.md
// section 18): "the tenant's product tagged fence_kind = line_post, pipe_class = <what the
// chosen security profile says>, coating = <the chosen coating>". This is what lets ONE
// template price correctly in a workspace whose catalogue has different SKUs, and lets a
// select input steer which product is picked.
//
// The attributes are matched against `products.custom_data` (text equality). The match is
// turned into a synthetic item key ("@match:{...}") so the rest of the pipeline, which
// carries a SKU-or-reference string per rule line, needs no new field; the pricing step
// recognises the prefix. Pure, no I/O.

import type { ProductMatch, TemplateInput } from "./types";

export const MATCH_PREFIX = "@match:";

export const ATTR_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
export const MAX_ATTR_VALUE = 80;
export const MAX_ATTRS = 8;

export type MatchAttrs = Record<string, string>;

export const isMatchKey = (key: string | null | undefined): boolean => typeof key === "string" && key.startsWith(MATCH_PREFIX);

const sortAttrs = (attrs: MatchAttrs): MatchAttrs =>
  Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The attributes a rule asks for, given the chosen input values: the fixed ones, plus the
 * `attrs` of the chosen option of each listed select input. An option with no attrs
 * contributes nothing.
 */
export function resolveMatchAttrs(
  match: ProductMatch, inputs: readonly TemplateInput[], params: Readonly<Record<string, number | string | boolean>>
): MatchAttrs {
  const out: MatchAttrs = { ...match.attrs };
  for (const key of match.from ?? []) {
    const input = inputs.find((i) => i.key === key);
    if (!input || input.type !== "select") continue;
    const chosen = (input.options ?? []).find((o) => o.key === params[key]);
    if (chosen?.attrs) Object.assign(out, chosen.attrs);
  }
  return sortAttrs(out);
}

/** The item key a match line carries. Stable: the same attributes always give the same text. */
export function matchKeyOf(attrs: MatchAttrs): string {
  return `${MATCH_PREFIX}${JSON.stringify(sortAttrs(attrs))}`;
}

export function parseMatchKey(key: string): MatchAttrs | null {
  if (!isMatchKey(key)) return null;
  try {
    const raw = JSON.parse(key.slice(MATCH_PREFIX.length)) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const out: MatchAttrs = {};
    for (const [k, v] of Object.entries(raw)) if (ATTR_KEY_RE.test(k) && typeof v === "string") out[k] = v;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

const words = (s: string) => s.replace(/_+/g, " ").trim();

/** Plain words for an item key: a SKU stays as it is, a match reads "line post, Schedule 40, PVC coated". */
export function itemKeyLabel(key: string): string {
  const attrs = parseMatchKey(key);
  if (!attrs) return key;
  const { fence_kind, ...rest } = attrs;
  return [fence_kind ? words(fence_kind) : null, ...Object.values(rest)].filter(Boolean).join(", ");
}

/** Does a product's `custom_data` carry every one of these attributes (text equality)? */
export function productHasAttrs(customData: Record<string, unknown> | null | undefined, attrs: MatchAttrs): boolean {
  if (!customData) return false;
  return Object.entries(attrs).every(([k, v]) => customData[k] === v);
}
