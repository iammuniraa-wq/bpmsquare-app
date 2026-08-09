import Link from "next/link";
import { c } from "@/lib/theme";

/**
 * A `<th>` that's also a sort toggle, for the server-rendered list pages
 * (same "no client JS" philosophy as ListFilterBar -- a plain Link that
 * flips `?sort=<key>&dir=asc|desc` in the URL, shareable/back-button-safe).
 * Clicking an inactive column sorts ascending; clicking the active column
 * flips direction.
 *
 * `hiddenParams` must carry every OTHER active filter/search param on the
 * page (q, status, type, dates, ...) or sorting would silently drop them --
 * same reasoning as ListFilterBar's own `hiddenParams`.
 */
export default function SortableTh({
  label,
  sortKey,
  currentSort,
  currentDir,
  baseHref,
  hiddenParams = {},
  style,
}: {
  label: string;
  sortKey: string;
  currentSort?: string;
  currentDir?: "asc" | "desc";
  baseHref: string;
  hiddenParams?: Record<string, string | undefined>;
  style?: React.CSSProperties;
}) {
  const isActive = currentSort === sortKey;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hiddenParams)) if (v) params.set(k, v);
  params.set("sort", sortKey);
  params.set("dir", nextDir);

  return (
    <th style={style}>
      <Link
        href={`${baseHref}?${params.toString()}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          color: isActive ? c.ink : "inherit", textDecoration: "none", cursor: "pointer",
        }}
      >
        {label}
        <span style={{ fontSize: 10, opacity: isActive ? 1 : 0.35, color: isActive ? c.accent : "inherit" }}>
          {isActive ? (currentDir === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </Link>
    </th>
  );
}
