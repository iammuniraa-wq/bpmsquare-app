"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

/**
 * Fog of War — engagement layer, 3-layer theme only (parent gates).
 * The tenant's own territory picklist rendered as a honeycomb: blue hexes
 * are territories with accounts (count + who discovered them), misted
 * hexes are the white space. The mist clears for real the day someone
 * creates the first account there (POST /api/accounts flags the discovery
 * and the create page fires the celebration).
 *
 * Renders nothing when the tenant has fewer than two configured
 * territories — a map with no fog isn't a map.
 */

type Cell = { territory: string; count: number; first_account: string | null; first_at: string | null };

export default function FogOfWar() {
  const [cells, setCells] = useState<Cell[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/engagement/territory");
        if (!res.ok) { setCells([]); return; }
        setCells((await res.json()).cells ?? []);
      } catch { setCells([]); }
    })();
  }, []);

  if (!cells || cells.length < 2) return null;
  const discovered = cells.filter((x) => x.count > 0).length;

  // Honeycomb rows: alternate 4 / 3 per row so odd rows nest into even ones.
  const rows: Cell[][] = [];
  let i = 0;
  while (i < cells.length) {
    const size = rows.length % 2 === 0 ? 4 : 3;
    rows.push(cells.slice(i, i + size));
    i += size;
  }

  const hexBase: React.CSSProperties = {
    width: 96, height: 106, flex: "none", position: "relative",
    clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 2, textAlign: "center", padding: "10px 8px",
  };

  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.4" fill="none" stroke={c.accent} strokeWidth="1.4" />
          <path d="M10.6 5.4 9.2 9.2 5.4 10.6 6.8 6.8Z" fill={c.accent} />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 650, color: c.ink }}>Territory map</span>
        <span style={{ fontSize: 11, color: c.hint }}>the mist is everywhere you haven&apos;t sold yet</span>
        <span style={{
          marginLeft: "auto", fontSize: 11, fontWeight: 700, color: c.accent,
          fontVariantNumeric: "tabular-nums",
        }}>
          {discovered} of {cells.length} discovered
        </span>
      </div>

      <div style={{ height: 5, borderRadius: 99, background: "var(--panel2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round((discovered / cells.length) * 100)}%`, background: c.accent, borderRadius: 99 }} />
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ width: "max-content", margin: "0 auto", padding: "4px 2px" }}>
          {rows.map((row, ri) => (
            <div key={ri} style={{
              display: "flex", gap: 7,
              marginTop: ri === 0 ? 0 : -22,
              marginLeft: ri % 2 === 1 ? 51 : 0,
            }}>
              {row.map((cell) => cell.count > 0 ? (
                <div
                  key={cell.territory}
                  title={cell.first_account ? `First account: ${cell.first_account}${cell.first_at ? ` · ${new Date(cell.first_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}` : undefined}
                  style={{
                    ...hexBase,
                    background: `linear-gradient(160deg, color-mix(in srgb, ${c.accent} 24%, var(--card-bg)), color-mix(in srgb, ${c.accent} 8%, var(--card-bg)))`,
                    color: c.ink,
                  }}
                >
                  <span style={{
                    minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999,
                    background: `color-mix(in srgb, ${c.accent} 22%, transparent)`,
                    fontSize: 10.5, fontWeight: 750, display: "grid", placeItems: "center",
                    fontVariantNumeric: "tabular-nums", color: c.accent,
                  }}>
                    {cell.count}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.15 }}>{cell.territory}</span>
                  <span style={{ fontSize: 9, color: c.hint, fontWeight: 600 }}>
                    account{cell.count === 1 ? "" : "s"}
                  </span>
                </div>
              ) : (
                <div
                  key={cell.territory}
                  title={`${cell.territory} — no accounts yet. The first one clears the mist.`}
                  style={{
                    ...hexBase,
                    background: "repeating-linear-gradient(115deg, var(--panel2), var(--panel2) 9px, var(--card-bg) 9px, var(--card-bg) 18px)",
                    color: c.hint,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M10.6 5.4 9.2 9.2 5.4 10.6 6.8 6.8Z" fill="currentColor" />
                  </svg>
                  <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.15, color: c.muted }}>{cell.territory}</span>
                  <span style={{ fontSize: 9, fontWeight: 600 }}>unexplored</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: c.hint }}>
        The first account opened in a misted territory clears it — permanently. Territories come from
        Settings → Sales config.
      </div>
    </section>
  );
}
