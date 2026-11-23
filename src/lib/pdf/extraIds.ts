import type { EntityExtraId } from "@/lib/constants";

const BAD = /[\u0000-\u001f<>]/g;

/** The extra ids of a legal entity, as a stored or posted value: clean text, a known print rule, a stable id each, at most six.
 *  An id with no label or no value is what an abandoned "+ Add id" leaves behind and is dropped. */
export function cleanExtraIds(input: unknown): EntityExtraId[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: EntityExtraId[] = [];
  for (const raw of input.slice(0, 12)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.replace(BAD, "").trim().slice(0, 60) : "";
    const value = typeof r.value === "string" ? r.value.replace(BAD, "").trim().slice(0, 60) : "";
    if (!label || !value) continue;
    let id = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : "";
    if (!id || seen.has(id)) id = `id${out.length + 1}${Math.random().toString(36).slice(2, 7)}`;
    seen.add(id);
    out.push({ id, label, value, print: r.print === "always" ? "always" : "selected_customers" });
    if (out.length >= 6) break;
  }
  return out;
}
