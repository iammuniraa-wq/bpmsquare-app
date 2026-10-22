"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { menuGuideId, normalizeMenuItems, type MenuItem } from "./menuItems";

export type { MenuItem };

const isPlainAnchor = (i: MenuItem) => !!i.newTab || !!i.href?.startsWith("/api/") || (!!i.href && !i.href.startsWith("/"));

/**
 * The "⋯" menu. Opens on click, closes on Esc, outside click, Tab or any
 * selection; arrow keys move between items (Home/End jump). Renders nothing
 * when every item is hidden, so a caller never shows an empty menu.
 */
export default function MoreMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const rows = useMemo(() => normalizeMenuItems(items), [items]);

  const focusItem = useCallback((index: number) => {
    const nodes = wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length].focus();
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, focusItem]);

  if (rows.length === 0) return null;

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const nodes = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusItem(current + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(nodes.length - 1); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="bpm-menu-wrap" ref={wrapRef} onKeyDown={open ? onMenuKeyDown : undefined}>
      <button
        ref={triggerRef}
        type="button"
        data-guide="record.more"
        className="bpm-btn bpm-btn-secondary bpm-btn-md bpm-btn-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>

      {open && (
        <div id={menuId} role="menu" aria-label={label} className="bpm-menu">
          {rows.map((item, i) => {
            if (item.divider) return <div key={`d${i}`} role="separator" className="bpm-menu-sep" />;
            const common = {
              role: "menuitem" as const,
              className: "bpm-menu-item",
              "data-danger": item.danger ? "true" : undefined,
              "data-guide": menuGuideId(item.label),
              tabIndex: -1,
            };
            if (item.href) {
              return isPlainAnchor(item)
                ? (
                  <a key={item.label} {...common} href={item.href} target={item.newTab ? "_blank" : undefined} rel={item.newTab ? "noopener noreferrer" : undefined} onClick={() => setOpen(false)}>
                    {item.label}
                  </a>
                )
                : (
                  <Link key={item.label} {...common} href={item.href} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                );
            }
            return (
              <button
                key={item.label}
                type="button"
                {...common}
                onClick={() => { setOpen(false); item.onSelect?.(); }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
