"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
export { applyColFilters } from "@/lib/listSort";

/**
 * C4C-style per-column search, shared by every object list table: a small ⌕
 * on the column header opens an inline input matching ONLY that column
 * (against the same value the column sorts by). Rendered INSIDE the header
 * cell -- the header row grows while open -- rather than as an overlay, so
 * the first data row (usually where the first match is) never gets covered.
 * Blur/Escape/Enter close it; ✕ clears on mousedown so it wins the blur.
 *
 * Host tables keep the state (one `colFilters` record + `openId`) and filter
 * their rows with `applyColFilters` before sorting; filters on multiple
 * columns AND together.
 */
export default function ColSearch({ id, label, colFilters, openId, setOpenId, setColFilter }: {
  id: string; label: string;
  colFilters: Record<string, string>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  setColFilter: (id: string, term: string) => void;
}) {
  const active = !!colFilters[id];
  const open = openId === id;
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: open ? "block" : "inline-block" }}>
      <button
        type="button"
        title={`Search in ${label}`}
        onClick={() => setOpenId(open ? null : id)}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
          marginLeft: 4, fontSize: 11, lineHeight: 1,
          color: active || open ? c.accent : c.hint, opacity: active || open ? 1 : 0.55,
        }}
      >⌕</button>
      {open && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
          <input
            autoFocus
            value={colFilters[id] ?? ""}
            onChange={(e) => setColFilter(id, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpenId(null); }}
            onBlur={() => setTimeout(() => setOpenId(null), 150)}
            placeholder={`Search ${label}…`}
            style={{
              border: `1px solid ${c.accent}60`, borderRadius: 6, padding: "4px 8px",
              fontSize: 12, color: c.ink, background: c.panel, outline: "none", width: 130,
              fontWeight: 400, textTransform: "none", letterSpacing: "normal",
            }}
          />
          {active && (
            <button
              type="button"
              title="Clear"
              onMouseDown={(e) => { e.preventDefault(); setColFilter(id, ""); setOpenId(null); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: c.hint, fontSize: 12, padding: 2 }}
            >✕</button>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * URL-param variant for the server-rendered tables (Suppliers, Inventory,
 * Invoices, Purchase Orders): commits `cf_<columnId>=<term>` to the URL on
 * Enter/blur, and the page applies it server-side with applyColFilters --
 * same shareable/back-button philosophy as ListFilterBar and SortableTh.
 */
export function ColSearchParam({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `cf_${id}`;
  const current = searchParams.get(key) ?? "";
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(current);
  useEffect(() => { setTerm(current); }, [current]);

  function commit(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set(key, value.trim()); else params.delete(key);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  const active = current !== "";
  return (
    <span onClick={(e) => { e.stopPropagation(); e.preventDefault(); }} style={{ display: open ? "block" : "inline-block" }}>
      <button
        type="button"
        title={`Search in ${label}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
          marginLeft: 4, fontSize: 11, lineHeight: 1,
          color: active || open ? c.accent : c.hint, opacity: active || open ? 1 : 0.55,
        }}
      >⌕</button>
      {open && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { commit(term); setOpen(false); }
              if (e.key === "Escape") { setTerm(current); setOpen(false); }
            }}
            onBlur={() => { commit(term); setTimeout(() => setOpen(false), 150); }}
            placeholder={`Search ${label}…`}
            style={{
              border: `1px solid ${c.accent}60`, borderRadius: 6, padding: "4px 8px",
              fontSize: 12, color: c.ink, background: c.panel, outline: "none", width: 130,
              fontWeight: 400, textTransform: "none", letterSpacing: "normal",
            }}
          />
          {active && (
            <button
              type="button"
              title="Clear"
              onMouseDown={(e) => { e.preventDefault(); setTerm(""); commit(""); setOpen(false); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: c.hint, fontSize: 12, padding: 2 }}
            >✕</button>
          )}
        </span>
      )}
    </span>
  );
}
