"use client";

import Link from "next/link";
import { c } from "@/lib/theme";

export interface BreakdownItem {
  label: string;
  count: number;
  color: string;
  href: string;
  active?: boolean;
}

/**
 * Horizontal stacked bar showing proportional breakdown by status/type.
 * Each segment is a clickable Link that filters the list.
 */
export default function BreakdownBar({ items }: { items: BreakdownItem[] }) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Stacked bar */}
      <div style={{
        display: "flex", height: 10, borderRadius: 8, overflow: "hidden",
        background: c.line, gap: 1, marginBottom: 10,
      }}>
        {items.map((item) => {
          const pct = (item.count / total) * 100;
          if (pct === 0) return null;
          return (
            <Link
              key={item.label}
              href={item.href}
              title={`${item.label}: ${item.count}`}
              style={{
                flex: `0 0 ${pct}%`,
                background: item.color,
                opacity: item.active === false ? 0.45 : 1,
                transition: "opacity 0.15s",
                display: "block",
              }}
            />
          );
        })}
      </div>

      {/* Legend row */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${item.active ? item.color : c.line}`,
              background: item.active ? `${item.color}18` : c.panel,
              color: item.active ? item.color : c.muted,
              textDecoration: "none", transition: "all 0.15s",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
            {item.label}
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: item.active ? item.color : c.ink,
            }}>
              {item.count}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
