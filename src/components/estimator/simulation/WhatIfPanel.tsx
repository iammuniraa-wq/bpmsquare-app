"use client";

import Button from "@/components/ui/Button";
import type { RiskDriver } from "@/lib/estimator/simulation";

const row: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: "var(--muted)", minWidth: 0 };

/** Sliders on the template's risk drivers, the margin and the "too thin" target. Nothing here is saved. */
export default function WhatIfPanel({
  drivers, multipliers, marginPct, baseMarginPct, targetPct, maxMargin,
  onMultiplier, onMargin, onTarget, onReset,
}: {
  drivers: RiskDriver[];
  multipliers: Record<string, number>;
  marginPct: number;
  baseMarginPct: number;
  targetPct: number;
  maxMargin: number;
  onMultiplier: (key: string, v: number) => void;
  onMargin: (v: number) => void;
  onTarget: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <span className="bpm-t-label">What if</span>
        <Button size="sm" variant="secondary" onClick={onReset}>Reset sliders</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {drivers.map((d) => {
          const m = multipliers[d.key] ?? 1;
          return (
            <label key={d.key} style={row}>
              <span>{d.label} <b style={{ color: "var(--ink)" }}>×{m.toFixed(2)}</b> <span style={{ color: "var(--hint)" }}>({(d.value * m).toLocaleString("en-GB", { maximumFractionDigits: 3 })} {d.unit})</span></span>
              <input type="range" min={0.7} max={1.5} step={0.01} value={m} onChange={(e) => onMultiplier(d.key, Number(e.target.value))}
                aria-valuetext={`times ${m.toFixed(2)}, ${(d.value * m).toFixed(2)} ${d.unit}`} />
            </label>
          );
        })}
        <label style={row}>
          <span>Margin on cost <b style={{ color: "var(--ink)" }}>{marginPct.toFixed(1)}%</b> <span style={{ color: "var(--hint)" }}>(estimate: {baseMarginPct}%)</span></span>
          <input type="range" min={0} max={maxMargin} step={0.5} value={marginPct} onChange={(e) => onMargin(Number(e.target.value))} aria-valuetext={`${marginPct.toFixed(1)} percent`} />
        </label>
        <label style={row}>
          <span>Margin counted as too thin below <b style={{ color: "var(--ink)" }}>{targetPct.toFixed(1)}%</b></span>
          <input type="range" min={0} max={maxMargin} step={0.5} value={targetPct} onChange={(e) => onTarget(Number(e.target.value))} aria-valuetext={`${targetPct.toFixed(1)} percent`} />
        </label>
      </div>
    </div>
  );
}
