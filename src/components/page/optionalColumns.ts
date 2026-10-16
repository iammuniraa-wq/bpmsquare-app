import type { MenuItem } from "@/components/ui/menuItems";

export type OptionalColumn = { id: string; label: string };

/** `?cols=phone,contracts` -> the set of off-by-default columns the user switched on. */
export function parseOptionalCols(raw: string | undefined, optional: OptionalColumn[]): Set<string> {
  const known = new Set(optional.map((o) => o.id));
  return new Set((raw ?? "").split(",").filter((id) => known.has(id)));
}

/**
 * The list page's replacement for the old in-table "Columns" picker: a
 * "Show / Hide <column>" link per optional column, for the list's "..." menu.
 * The choice lives in the URL (`?cols=`), so it survives sorting and paging as
 * long as the caller carries `colsParam` in its link params.
 */
export function optionalColumnsMenu({
  baseHref, optional, shown, linkParams, sort, dir,
}: {
  baseHref: string;
  optional: OptionalColumn[];
  shown: Set<string>;
  /** Every active filter / search param (without `cols`). */
  linkParams: Record<string, string | undefined>;
  sort?: string;
  dir?: string;
}): { colsParam: string | undefined; menuItems: MenuItem[] } {
  const colsParam = optional.filter((o) => shown.has(o.id)).map((o) => o.id).join(",") || undefined;
  const menuItems: MenuItem[] = optional.map((o) => {
    const next = optional.filter((x) => (x.id === o.id ? !shown.has(x.id) : shown.has(x.id))).map((x) => x.id).join(",");
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...linkParams, cols: next || undefined, sort, dir: sort ? dir : undefined })) if (v) qs.set(k, v);
    const s = qs.toString();
    return { label: `${shown.has(o.id) ? "Hide" : "Show"} ${o.label} column`, href: s ? `${baseHref}?${s}` : baseHref };
  });
  return { colsParam, menuItems };
}
