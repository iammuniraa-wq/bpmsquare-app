import Link from "next/link";
import { c } from "@/lib/theme";
import { pageCount } from "@/lib/paginate";

/**
 * Server-rendered pager for the GET-form list pages (same "no client JS"
 * philosophy as ListFilterBar/SortableTh) -- a plain Link that flips
 * `?page=N` in the URL. `hiddenParams` must carry every other active
 * filter/sort/search param or paging would silently drop them, same
 * reasoning as SortableTh's own hiddenParams.
 */
export default function PagerLink({
  page, total, pageSize, baseHref, hiddenParams = {},
}: {
  page: number;
  total: number;
  pageSize: number;
  baseHref: string;
  hiddenParams?: Record<string, string | undefined>;
}) {
  const pages = pageCount(total, pageSize);
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(hiddenParams)) if (v) params.set(k, v);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  const linkStyle = (disabled: boolean): React.CSSProperties => ({
    padding: "6px 11px", borderRadius: 6, border: `1px solid ${c.line}`,
    background: "var(--panel)", color: disabled ? c.hint : c.ink,
    fontSize: 12.5, textDecoration: "none", opacity: disabled ? 0.55 : 1,
    pointerEvents: disabled ? "none" : "auto",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 12, color: c.muted }}>
        Showing {start}–{end} of {total}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Link href={hrefFor(page - 1)} style={linkStyle(page <= 1)} aria-disabled={page <= 1}>← Prev</Link>
        <span style={{ fontSize: 12.5, color: c.muted, padding: "0 4px" }}>
          Page {page} of {pages}
        </span>
        <Link href={hrefFor(page + 1)} style={linkStyle(page >= pages)} aria-disabled={page >= pages}>Next →</Link>
      </div>
    </div>
  );
}
