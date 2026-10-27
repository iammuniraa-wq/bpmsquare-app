/**
 * The tenant-defined (cf_) part of a custom_data value from a request body or a file row.
 *
 * custom_data is one JSON column per record, but only keys a tenant created through
 * Settings > Custom fields (always cf_-prefixed) may land in it from the outside, so a
 * client cannot smuggle an arbitrary key into the column. Returns undefined when the
 * input is not an object at all, so a caller can tell "nothing sent" from "an empty set".
 */
export function cfOnly(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => k.startsWith("cf_")));
}

/**
 * An existing custom_data with the cf_ values of a file row merged over it. Keys the row does
 * not mention are kept, so a bulk update of one custom field never wipes the others.
 * A blank cell leaves the stored value alone (a file cannot clear a field by omission).
 */
export function mergeCfValues(
  existing: unknown,
  values: Record<string, string>
): Record<string, unknown> | null {
  const incoming: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith("cf_") && typeof v === "string" && v.trim()) incoming[k] = v.trim();
  }
  if (Object.keys(incoming).length === 0) return null;
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  return { ...base, ...incoming };
}
