"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SEARCH_OBJECTS, type SearchObjectType, type SearchResult } from "@/lib/globalSearch";
import { SearchIcon, XIcon } from "@/components/Icons";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

/** Global "search everything" bar -- present on every authenticated screen
 * (mounted once in Shell), fuzzy-matches across every major object (account
 * name, quote/case/invoice ref, asset serial, etc.), optionally scoped to
 * one object type via the dropdown. Ctrl/Cmd+K focuses it from anywhere. */
export default function GlobalSearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [objectType, setObjectType] = useState<SearchObjectType | "">("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: term });
      if (objectType) params.set("type", objectType);
      fetch(`/api/search?${params.toString()}`)
        .then((r) => r.json())
        .then((json) => setResults(Array.isArray(json.results) ? json.results : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, objectType]);

  const grouped = useMemo(() => {
    if (objectType) return [{ type: objectType, items: results }];
    const byType = new Map<SearchObjectType, SearchResult[]>();
    for (const r of results) {
      const list = byType.get(r.type);
      if (list) list.push(r); else byType.set(r.type, [r]);
    }
    return SEARCH_OBJECTS
      .map((o) => ({ type: o.type, items: byType.get(o.type) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [objectType, results]);

  function goTo(href: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(href);
  }

  const showDropdown = open && query.trim().length >= MIN_QUERY_LEN;

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 480 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)",
        borderRadius: 8, padding: "0 10px", height: 32,
      }}>
        <SearchIcon size={14} color="#7a9ab8" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search accounts, quotes, cases, ref numbers…"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "#e2e7ee", fontSize: 12.5, height: "100%",
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
            title="Clear"
          >
            <XIcon size={12} color="#7a9ab8" />
          </button>
        )}
        <select
          value={objectType}
          onChange={(e) => setObjectType(e.target.value as SearchObjectType | "")}
          title="Limit search to one object"
          style={{
            background: "rgba(255,255,255,.06)", border: "none", borderLeft: "1px solid rgba(255,255,255,.12)",
            color: "#9db3c4", fontSize: 11, height: "100%", paddingLeft: 8, marginLeft: 2,
            outline: "none", cursor: "pointer", flexShrink: 0,
          }}
        >
          <option value="">All objects</option>
          {SEARCH_OBJECTS.map((o) => <option key={o.type} value={o.type}>{o.label}</option>)}
        </select>
        <span style={{ fontSize: 10, color: "#4a6070", flexShrink: 0, paddingLeft: 2 }}>⌘K</span>
      </div>

      {showDropdown && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 400 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
            background: "#152233", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10,
            boxShadow: "0 12px 36px rgba(0,0,0,.5)", zIndex: 401,
            maxHeight: 420, overflowY: "auto", padding: "6px 0",
          }}>
            {loading && results.length === 0 && (
              <div style={{ padding: "14px 16px", fontSize: 12, color: "#7a9ab8" }}>Searching…</div>
            )}
            {!loading && grouped.length === 0 && (
              <div style={{ padding: "14px 16px", fontSize: 12, color: "#7a9ab8" }}>No matches for "{query.trim()}".</div>
            )}
            {grouped.map((group) => {
              const def = SEARCH_OBJECTS.find((o) => o.type === group.type);
              return (
                <div key={group.type}>
                  <div style={{
                    padding: "6px 14px 4px", fontSize: 10, fontWeight: 700,
                    color: "#5a8ab0", textTransform: "uppercase", letterSpacing: 0.6,
                  }}>
                    {def?.icon} {def?.label}
                  </div>
                  {group.items.map((r) => (
                    <button
                      key={`${r.type}:${r.id}`}
                      onClick={() => goTo(r.href)}
                      style={{
                        display: "flex", flexDirection: "column", width: "100%", textAlign: "left",
                        padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#e2e7ee" }}>{r.title}</span>
                      <span style={{ fontSize: 11, color: "#7a9ab8" }}>{r.subtitle}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
