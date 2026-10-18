"use client";

import type { RiskResult } from "@/lib/estimator/simulation";

type Ok = Extract<RiskResult, { available: true }>;

const W = 640;
const H = 190;
const PL = 10;
const PR = 10;
const PT = 14;
const PB = 34;

/** Simulated cost against the quote price. Everything (labels too) stays inside the viewBox. */
export function CostHistogram({ risk, compact }: { risk: Ok; compact: (n: number) => string }) {
  const { histogram: h } = risk;
  const lo = Math.min(h.lo, risk.price);
  const hi = Math.max(h.hi, risk.price);
  const span = hi - lo || 1;
  const x = (v: number) => PL + ((v - lo) / span) * (W - PL - PR);
  const maxCount = Math.max(1, ...h.counts);
  const binW = ((h.hi - h.lo) / h.counts.length / span) * (W - PL - PR);
  const priceX = x(risk.price);
  const priceAnchor = priceX > W * 0.6 ? "end" : "start";
  const medX = Math.min(W - 60, Math.max(60, x(risk.p50)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" width="100%" style={{ display: "block", maxWidth: "100%", height: "auto" }}
      aria-label={`Histogram of ${risk.runs} simulated costs from ${compact(risk.min)} to ${compact(risk.max)}, median ${compact(risk.p50)}. The quote price is ${compact(risk.price)}; ${(risk.prob_over_price * 100).toFixed(1)} percent of runs cost more.`}>
      {h.counts.map((n, i) => {
        const bh = (n / maxCount) * (H - PT - PB);
        const bx = x(h.lo) + i * binW;
        return <rect key={i} x={bx + 1} y={H - PB - bh} width={Math.max(1, binW - 2)} height={bh} rx={2}
          style={{ fill: bx + binW / 2 > priceX ? "var(--err-ink)" : "var(--accent)", opacity: 0.75 }} />;
      })}
      <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} style={{ stroke: "var(--line)", strokeWidth: 1 }} />
      <line x1={priceX} x2={priceX} y1={PT} y2={H - PB} style={{ stroke: "var(--err-ink)", strokeWidth: 2, strokeDasharray: "5 3" }} />
      <text x={priceAnchor === "end" ? priceX - 6 : priceX + 6} y={PT + 9} textAnchor={priceAnchor} fontSize={11} style={{ fill: "var(--ink)" }}>
        Quote price {compact(risk.price)}
      </text>
      <text x={PL} y={H - 8} fontSize={11} style={{ fill: "var(--muted)" }}>{compact(h.lo)}</text>
      <text x={medX} y={H - 8} fontSize={11} textAnchor="middle" style={{ fill: "var(--ink)" }}>median {compact(risk.p50)}</text>
      <text x={W - PR} y={H - 8} fontSize={11} textAnchor="end" style={{ fill: "var(--muted)" }}>{compact(h.hi)}</text>
    </svg>
  );
}

/** One-at-a-time swings, widest first. Each row says its range in numbers. */
export function Tornado({ risk, compact }: { risk: Ok; compact: (n: number) => string }) {
  const rows = risk.tornado;
  const min = Math.min(...rows.map((r) => r.cost_low));
  const max = Math.max(...rows.map((r) => r.cost_high));
  const span = max - min || 1;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }} aria-label="Which drivers move the cost most">
      {rows.map((r) => (
        <li key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(100px, 170px) minmax(0, 1fr)", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>{r.label}</span>
          <div>
            <div style={{ position: "relative", height: 14, background: "var(--panel2)", borderRadius: 5, border: "1px solid var(--line)" }}>
              <div style={{
                position: "absolute", top: 0, bottom: 0, left: `${((r.cost_low - min) / span) * 100}%`,
                width: `${Math.max(1.5, ((r.cost_high - r.cost_low) / span) * 100)}%`, borderRadius: 4, background: "var(--accent)",
              }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {compact(r.cost_low)} to {compact(r.cost_high)} (swing {compact(r.swing)})
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
