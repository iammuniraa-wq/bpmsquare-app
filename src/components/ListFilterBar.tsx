import Link from "next/link";
import { c } from "@/lib/theme";

export type SelectFilter = {
  name: string;
  value: string | undefined;
  placeholder: string;
  options: { value: string; label: string }[];
};

export type DateFilter = { name: string; value: string | undefined; label: string };

/**
 * Shared GET-form filter bar for the server-rendered list pages.
 *
 * These pages filter through `searchParams`, so the control is a plain
 * `<form method="GET">` -- no client component, no JS needed, and the
 * resulting URL is shareable and back-button friendly, which a
 * useState-based filter isn't. Extracted from the hand-rolled bar on
 * /accounts so the eight-odd lists that had no filters at all get exactly
 * the same behaviour and styling instead of eight near-copies.
 *
 * `hiddenParams` preserves filters that live outside this bar (e.g. the
 * status chosen from a summary tile) -- without them, submitting the search
 * box would silently drop the active status filter.
 */
export default function ListFilterBar({
  searchName = "q",
  searchValue,
  searchPlaceholder,
  selects = [],
  dates = [],
  hiddenParams = {},
  clearHref,
}: {
  searchName?: string;
  searchValue?: string;
  searchPlaceholder: string;
  selects?: SelectFilter[];
  dates?: DateFilter[];
  hiddenParams?: Record<string, string | undefined>;
  /** Where "Clear" points -- the bare list route. */
  clearHref: string;
}) {
  const field: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`,
    fontSize: 13, color: c.ink, background: "var(--panel)", outline: "none",
  };
  const hasAny =
    !!searchValue ||
    selects.some((s) => !!s.value) ||
    dates.some((d) => !!d.value) ||
    Object.values(hiddenParams).some(Boolean);

  return (
    <form method="GET" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      {Object.entries(hiddenParams).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null
      )}

      <input
        name={searchName}
        defaultValue={searchValue ?? ""}
        placeholder={searchPlaceholder}
        autoComplete="off"
        style={{ ...field, flex: "1 1 200px", minWidth: 160 }}
      />

      {selects.map((s) => (
        <select key={s.name} name={s.name} defaultValue={s.value ?? ""} style={{ ...field, color: s.value ? c.ink : c.hint, cursor: "pointer" }}>
          <option value="">{s.placeholder}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}

      {dates.map((d) => (
        <label key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: c.hint }}>
          {d.label}
          <input type="date" name={d.name} defaultValue={d.value ?? ""} style={field} />
        </label>
      ))}

      <button
        type="submit"
        style={{
          padding: "7px 14px", borderRadius: 7, border: "none",
          background: `var(--modern-accent, ${c.accent})`, color: "#fff",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}
      >
        Filter
      </button>

      {hasAny && (
        <Link href={clearHref} style={{ fontSize: 12, color: c.hint, textDecoration: "none", whiteSpace: "nowrap" }}>
          Clear ✕
        </Link>
      )}
    </form>
  );
}
