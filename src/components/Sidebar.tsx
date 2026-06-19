"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NAV, WORKSPACE_NAME } from "@/lib/constants";
import type { NavItem } from "@/lib/constants";
import { c, g } from "@/lib/theme";
import Logo from "./Logo";

const NAV_ORDER_KEY = "vevey_nav_order_v1";

type FlatItem = NavItem & { group: string };

// ── Pillar accent colours for the dark sidebar ────────────────────────────────
const PILLAR_COLOR: Record<string, string> = {
  blue:   "#378ADD",
  purple: "#7f77dd",
  teal:   "#1d9e75",
  amber:  "#f6b23c",
  red:    "#e05252",
  green:  "#639922",
};

function flattenNav(): FlatItem[] {
  return NAV.flatMap((grp) => grp.items.map((item) => ({ ...item, group: grp.group })));
}

function loadItems(): FlatItem[] {
  const defaults = flattenNav();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY);
    if (!raw) return defaults;
    const savedHrefs: string[] = JSON.parse(raw);
    const byHref = new Map(defaults.map((i) => [i.href, i]));
    const reordered = savedHrefs
      .map((h) => byHref.get(h))
      .filter((i): i is FlatItem => !!i);
    // Append any nav items added after the last save (new features).
    const saved = new Set(savedHrefs);
    const fresh = defaults.filter((i) => !saved.has(i.href));
    return [...reordered, ...fresh];
  } catch {
    return defaults;
  }
}

function saveItems(items: FlatItem[]) {
  try {
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(items.map((i) => i.href)));
  } catch {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  // Start with flattened defaults (avoids SSR flash) then hydrate from localStorage.
  const [items, setItems] = useState<FlatItem[]>(() => flattenNav());
  const [hovered, setHovered] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null); // insertion point (0 = before first)
  const dragIdx = useRef<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    setItems(loadItems());
  }, []);

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const onDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    dragging.current = true;
    e.dataTransfer.effectAllowed = "move";
    // Suppress default browser drag-ghost — we style the item via opacity instead.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    e.dataTransfer.setDragImage(canvas, 0, 0);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Show drop indicator above or below this item based on cursor position.
    const rect = e.currentTarget.getBoundingClientRect();
    const indicator = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
    setDropAt(indicator);
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Only clear if the cursor leaves the sidebar entirely.
    const aside = e.currentTarget.closest("aside");
    if (aside && !aside.contains(e.relatedTarget as Node)) setDropAt(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    const to = dropAt;
    dragIdx.current = null;
    dragging.current = false;

    if (from === null || to === null || from === to || from + 1 === to) {
      setDropAt(null);
      return;
    }

    const next = [...items];
    const [moved] = next.splice(from, 1);
    // Adjust target index: removing 'from' shifts later indices left.
    const adjusted = from < to ? to - 1 : to;
    next.splice(adjusted, 0, moved);
    setItems(next);
    saveItems(next);
    setDropAt(null);
  };

  const onDragEnd = () => {
    dragIdx.current = null;
    dragging.current = false;
    setDropAt(null);
  };

  return (
    <aside
      style={{
        width: 236,
        background: g.sidebar,
        flexShrink: 0,
        padding: "16px 12px",
        color: "#aebccd",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Logo / workspace header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "4px 6px 14px",
          borderBottom: "1px solid rgba(255,255,255,.08)",
          marginBottom: 10,
        }}
      >
        <Logo size={34} />
        <div>
          <div style={{ fontWeight: 600, color: "#fff", fontSize: 14 }}>
            Vevey<span style={{ color: "#7fb4ec" }}>CRM</span>
          </div>
          <div style={{ fontSize: 11, color: "#8aa0b8" }}>{WORKSPACE_NAME}</div>
        </div>
      </div>

      {/* Hint label */}
      <div style={{ fontSize: 10, color: "#3d5166", letterSpacing: 0.8, paddingLeft: 10, marginBottom: 4 }}>
        NAVIGATION · drag to reorder
      </div>

      {/* Draggable nav list */}
      <nav style={{ flex: 1 }}>
        {items.map((item, idx) => {
          const on = isActive(item.href);
          const isDraggingThis = dragging.current && dragIdx.current === idx;
          const dotColor = PILLAR_COLOR[item.pillar] ?? "#378ADD";
          const showHandle = hovered === idx;

          return (
            <div
              key={item.href}
              draggable
              onDragStart={(e) => onDragStart(e, idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Drop indicator — appears before this item when it's the insertion point */}
              {dropAt === idx && (
                <div style={{
                  height: 2,
                  background: "#378ADD",
                  borderRadius: 2,
                  margin: "2px 4px",
                  boxShadow: "0 0 8px #378ADD99",
                }} />
              )}

              <Link
                href={item.href}
                onClick={onNavigate}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 1,
                  color: on ? "#fff" : "#aebccd",
                  background: on ? c.accent : "transparent",
                  opacity: isDraggingThis ? 0.35 : 1,
                  textDecoration: "none",
                  userSelect: "none",
                  transition: "background 0.12s",
                  cursor: "default",
                }}
              >
                {/* Pillar dot */}
                <span style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: on ? "rgba(255,255,255,.65)" : dotColor,
                  flexShrink: 0,
                }} />

                {/* Icon */}
                <span style={{ width: 16, textAlign: "center", fontSize: 14, flexShrink: 0 }}>
                  {item.icon}
                </span>

                {/* Label */}
                <span style={{ flex: 1 }}>{item.label}</span>

                {/* Badge */}
                {item.badge != null && (
                  <span style={{
                    fontSize: 10,
                    background: "rgba(255,255,255,.13)",
                    color: "#dce6f1",
                    borderRadius: 10,
                    padding: "1px 7px",
                    flexShrink: 0,
                  }}>
                    {item.badge}
                  </span>
                )}

                {/* Drag handle — visible on hover */}
                <span style={{
                  fontSize: 14,
                  color: showHandle ? "rgba(255,255,255,.35)" : "transparent",
                  flexShrink: 0,
                  lineHeight: 1,
                  cursor: "grab",
                  transition: "color 0.1s",
                }}>
                  ⠿
                </span>
              </Link>
            </div>
          );
        })}

        {/* Bottom drop zone */}
        {dropAt === items.length && (
          <div style={{
            height: 2,
            background: "#378ADD",
            borderRadius: 2,
            margin: "2px 4px",
            boxShadow: "0 0 8px #378ADD99",
          }} />
        )}
      </nav>

      {/* Reset link */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 10, marginTop: 4 }}>
        <button
          onClick={() => {
            localStorage.removeItem(NAV_ORDER_KEY);
            setItems(flattenNav());
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "#3d5166",
            fontSize: 11,
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 5,
            width: "100%",
            textAlign: "left",
          }}
        >
          ↺ Reset nav order
        </button>
      </div>
    </aside>
  );
}
