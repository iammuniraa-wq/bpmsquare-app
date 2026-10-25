"use client";

import { useEffect, useId, useRef, useState } from "react";
import { c } from "@/lib/theme";
import type { MasterKind } from "@/lib/contractProjects/types";

type Hit = { code: string; name: string };

/**
 * A code box that searches the workspace's list as you type (Settings > Contract projects holds the list). Typing a code that is not
 * in the list is allowed here and refused when the budget is saved, with the code named, so a pasted code never silently vanishes.
 */
export default function MasterPicker({ kind, value, onChange, disabled, label, guide }: {
  kind: MasterKind;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  label: string;
  guide?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [name, setName] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  async function search(q: string) {
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/contract-projects/masters?kind=${kind}&page_size=20&q=${encodeURIComponent(q)}`);
      const j = await res.json().catch(() => ({}));
      if (mine === seq.current && res.ok) setHits(((j.rows ?? []) as Hit[]).map((r) => ({ code: r.code, name: r.name })));
    } catch { /* the box still accepts a typed code */ }
  }
  function typed(v: string) {
    onChange(v);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void search(v.trim()); }, 250);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (!value) setName(""); else { const h = hits.find((x) => x.code === value); if (h) setName(h.name); } }, [value, hits]);

  return (
    <div style={{ position: "relative" }}>
      <input
        className="bpm-input" value={value} disabled={disabled} aria-label={label} title={name || undefined} data-guide={guide}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" maxLength={40}
        style={{ minHeight: 44, width: "100%" }}
        onFocus={() => { setOpen(true); void search(value.trim()); }}
        onChange={(e) => typed(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      />
      {open && hits.length > 0 && !disabled && (
        <ul id={listId} role="listbox" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, minWidth: 260, maxWidth: 340, maxHeight: 240, overflowY: "auto", margin: "2px 0 0", padding: 4, listStyle: "none", background: "var(--card-bg)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
          {hits.map((h) => (
            <li key={h.code} role="option" aria-selected={h.code === value}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(h.code); setName(h.name); setOpen(false); }}
                style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: 0, padding: "9px 8px", minHeight: 44, cursor: "pointer", color: c.ink, fontSize: 13, borderRadius: 6 }}>
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace", color: c.muted, flexShrink: 0 }}>{h.code}</span><span>{h.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
