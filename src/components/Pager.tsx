"use client";

import { c } from "@/lib/theme";
import { pageCount } from "@/lib/paginate";

/**
 * Client-side pager for useState-driven list tables (sorted/filtered
 * entirely in memory). For server-rendered pages using the GET-form filter
 * pattern (ListFilterBar), use PagerLink instead -- it drives paging via a
 * `?page=` URL param rather than component state.
 */
export default function Pager({
  page, total, pageSize, onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  if (total === 0) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const btn = (label: React.ReactNode, target: number, disabled: boolean): React.ReactNode => (
    <button
      type="button"
      onClick={() => onPage(target)}
      disabled={disabled}
      style={{
        padding: "6px 11px", borderRadius: 6, border: `1px solid ${c.line}`,
        background: "var(--panel)", color: disabled ? c.hint : c.ink,
        fontSize: 12.5, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 12, color: c.muted }}>
        Showing {start}–{end} of {total}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {btn("← Prev", page - 1, page <= 1)}
        <span style={{ fontSize: 12.5, color: c.muted, padding: "0 4px" }}>
          Page {page} of {pages}
        </span>
        {btn("Next →", page + 1, page >= pages)}
      </div>
    </div>
  );
}
