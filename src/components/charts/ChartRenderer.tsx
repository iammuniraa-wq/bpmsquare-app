"use client";

import { useId, useState } from "react";
import { c, pillar } from "@/lib/theme";
import type { NormalizedReport } from "@/lib/reportView";

// Report Builder's chart renderer. Follows the dataviz skill's mark specs:
// bars ≤24px thick with a 4px rounded data-end, 2px lines, hairline
// recessive gridlines, sparing direct labels (value at the tip/end only),
// a per-mark hover tooltip, and a table view always one click away (never
// gated behind hover) -- a table-only report renders as a table with no
// further affordance needed since it already is the fallback.
//
// Single accent hue throughout: a v1 report is one measure across category
// labels (identity lives in the axis text, not per-bar color), so no
// legend is needed -- "a single series needs no legend box."

const ACCENT = pillar.blue.base;
const OTHER = c.hint;

// Indian-market compact numbers: 50K, 4.5L, 2.3Cr -- these are ₹ values far
// more often than not, and 250M reads foreign to the audience reading them.
function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return (n / 10_000_000).toFixed(abs >= 100_000_000 ? 0 : 1).replace(/\.0$/, "") + "Cr";
  if (abs >= 100_000) return (n / 100_000).toFixed(abs >= 1_000_000 ? 0 : 1).replace(/\.0$/, "") + "L";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return Math.round(n).toLocaleString("en-IN");
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / magnitude;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * magnitude;
}

function Tooltip({ x, y, label, value }: { x: string; y: string; label: string; value: number }) {
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, transform: "translate(-50%, -100%)",
        pointerEvents: "none", zIndex: 5, marginTop: -8,
        background: c.panel, border: `1px solid ${c.line}`, borderRadius: 6,
        padding: "6px 9px", boxShadow: "0 4px 14px rgba(0,0,0,.12)", whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString("en-IN")}</div>
      <div style={{ fontSize: 11, color: c.muted }}>{label}</div>
    </div>
  );
}

function TableView({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${c.line}`, color: c.hint, fontWeight: 700, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                {col.replace(/_/g, " ").replace(/\./g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => {
                const v = row[col];
                const display = v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                return (
                  <td key={col} style={{ padding: "6px 10px", borderBottom: `1px solid ${c.line}`, color: c.ink, fontVariantNumeric: "tabular-nums" }}>
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length || 1} style={{ padding: "16px 10px", color: c.muted, textAlign: "center" }}>No rows matched.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Category breakdowns almost always carry real-world names (accounts,
// products) far too long for a vertical x-axis -- colliding, truncated
// labels were exactly the failure mode of the first live report. Horizontal
// bars give every label a full line of its own; vertical stays only for the
// short-label, few-category case (statuses, outcome buckets).
function useHorizontal(series: { key: string; value: number }[]): boolean {
  return series.length > 6 || series.some((s) => s.key.length > 10);
}

function HorizontalBarChart({ series }: { series: { key: string; value: number }[] }) {
  const W = 640, ROW_H = 30, PAD_T = 6, PAD_B = 6, LABEL_W = 170, VALUE_W = 62, PAD_R = 8;
  const H = PAD_T + PAD_B + series.length * ROW_H;
  const plotW = W - LABEL_W - VALUE_W - PAD_R;
  const max = niceMax(Math.max(...series.map((s) => s.value), 1));
  const [hover, setHover] = useState<number | null>(null);
  const barH = Math.min(18, ROW_H * 0.62);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Bar chart">
        {series.map((s, i) => {
          const y = PAD_T + ROW_H * i;
          const cy = y + ROW_H / 2;
          const barW = Math.max((s.value / max) * plotW, 1.5);
          const isOther = s.key === "Other";
          const fill = isOther ? OTHER : ACCENT;
          const label = s.key.length > 24 ? s.key.slice(0, 23) + "…" : s.key;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} style={{ cursor: "pointer" }}>
              <rect x={0} y={y} width={W} height={ROW_H} fill={hover === i ? "color-mix(in srgb, currentColor 4%, transparent)" : "transparent"} />
              <text x={LABEL_W - 10} y={cy} textAnchor="end" dominantBaseline="middle" fontSize={11.5} fill={isOther ? c.hint : c.muted}>
                <title>{s.key}</title>
                {label}
              </text>
              <rect x={LABEL_W} y={cy - barH / 2} width={barW} height={barH} rx={4} ry={4}
                fill={fill} opacity={hover === null || hover === i ? 1 : 0.45} />
              <text x={LABEL_W + barW + 7} y={cy} dominantBaseline="middle" fontSize={11} fontWeight={650}
                fill={isOther ? c.hint : c.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatCompact(s.value)}
              </text>
            </g>
          );
        })}
        <line x1={LABEL_W} x2={LABEL_W} y1={PAD_T} y2={H - PAD_B} stroke={c.line} strokeWidth={1} />
      </svg>
      {hover !== null && (
        <Tooltip
          x={(LABEL_W + Math.max((series[hover].value / max) * plotW, 1.5) / 2) / W * 100 + "%"}
          y={(PAD_T + ROW_H * hover + ROW_H / 2) / (PAD_T + PAD_B + series.length * ROW_H) * 100 + "%"}
          label={series[hover].key}
          value={series[hover].value}
        />
      )}
    </div>
  );
}

function BarChart({ series }: { series: { key: string; value: number }[] }) {
  const W = 640, H = 260, PAD_L = 44, PAD_B = 40, PAD_T = 12, PAD_R = 12;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = niceMax(Math.max(...series.map((s) => s.value), 1));
  const bandW = plotW / series.length;
  const barW = Math.min(24, bandW * 0.6);
  const [hover, setHover] = useState<number | null>(null);
  const gridId = useId();

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Bar chart">
        <g>
          {ticks.map((t, i) => {
            const y = PAD_T + plotH - (t / max) * plotH;
            return (
              <g key={i}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={c.line} strokeWidth={1} />
                <text x={PAD_L - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={c.hint}>
                  {formatCompact(t)}
                </text>
              </g>
            );
          })}
        </g>
        {series.map((s, i) => {
          const x = PAD_L + bandW * i + (bandW - barW) / 2;
          const barH = (s.value / max) * plotH;
          const y = PAD_T + plotH - barH;
          const isOther = s.key === "Other";
          const fill = isOther ? OTHER : ACCENT;
          return (
            <g key={`${gridId}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} style={{ cursor: "pointer" }}>
              <rect x={x} y={PAD_T} width={barW} height={plotH} fill="transparent" />
              <rect
                x={x} y={y} width={barW} height={Math.max(barH, 1)}
                rx={4} ry={4}
                fill={fill}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {barH > 6 && <rect x={x} y={y + Math.max(barH - 4, 0)} width={barW} height={Math.min(4, barH)} fill={fill} />}
              <text x={x + barW / 2} y={H - PAD_B + 16} textAnchor="middle" fontSize={10.5} fill={c.muted}>
                {s.key.length > 12 ? s.key.slice(0, 11) + "…" : s.key}
              </text>
            </g>
          );
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke={c.line} strokeWidth={1} />
      </svg>
      {hover !== null && (
        <Tooltip
          x={(PAD_L + bandW * hover + bandW / 2) / W * 100 + "%"}
          y={(PAD_T + plotH - (series[hover].value / max) * plotH) / H * 100 + "%"}
          label={series[hover].key}
          value={series[hover].value}
        />
      )}
    </div>
  );
}

function AutoBarChart({ series }: { series: { key: string; value: number }[] }) {
  return useHorizontal(series) ? <HorizontalBarChart series={series} /> : <BarChart series={series} />;
}

function LineChart({ series }: { series: { key: string; value: number }[] }) {
  const W = 640, H = 260, PAD_L = 44, PAD_B = 32, PAD_T = 12, PAD_R = 12;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = niceMax(Math.max(...series.map((s) => s.value), 1));
  const stepX = series.length > 1 ? plotW / (series.length - 1) : 0;
  const [hover, setHover] = useState<number | null>(null);

  const points = series.map((s, i) => ({
    x: PAD_L + stepX * i,
    y: PAD_T + plotH - (s.value / max) * plotH,
    ...s,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Line chart">
        {ticks.map((t, i) => {
          const y = PAD_T + plotH - (t / max) * plotH;
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={c.line} strokeWidth={1} />
              <text x={PAD_L - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={c.hint}>{formatCompact(t)}</text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} style={{ cursor: "pointer" }}>
            <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={hover === i ? 5 : 4} fill={ACCENT} stroke={c.panel} strokeWidth={2} />
          </g>
        ))}
        {points.length > 0 && (
          <text x={points[points.length - 1].x} y={points[points.length - 1].y - 10} textAnchor="end" fontSize={11} fontWeight={700} fill={c.ink}>
            {formatCompact(points[points.length - 1].value)}
          </text>
        )}
        {points.map((p, i) => (
          (i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
            <text key={i} x={p.x} y={H - PAD_B + 16} textAnchor="middle" fontSize={10} fill={c.muted}>{p.key}</text>
          )
        ))}
      </svg>
      {hover !== null && (
        <Tooltip
          x={(points[hover].x / W) * 100 + "%"}
          y={(points[hover].y / H) * 100 + "%"}
          label={points[hover].key}
          value={points[hover].value}
        />
      )}
    </div>
  );
}

function StatTile({ value }: { value: number }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 48, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

export default function ChartRenderer({ report }: { report: NormalizedReport }) {
  const [asTable, setAsTable] = useState(false);
  const hasTableToggle = (report.chartType === "bar" || report.chartType === "line") && !!report.series?.length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>{report.title}</div>
        {hasTableToggle && (
          <button
            onClick={() => setAsTable((v) => !v)}
            style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {asTable ? "View as chart" : "View as table"}
          </button>
        )}
      </div>
      {report.interpretation && (
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 12 }}>{report.interpretation}</div>
      )}
      {report.droppedSensitiveFields.length > 0 && (
        <div style={{ fontSize: 11, color: pillar.amber.fg, marginBottom: 12 }}>
          Some fields ({report.droppedSensitiveFields.join(", ")}) were left out of this table — personal data isn&rsquo;t shown in bulk reports.
        </div>
      )}

      {report.chartType === "stat" && <StatTile value={report.statValue ?? 0} />}

      {report.chartType === "bar" && report.series && (
        asTable
          ? <TableView columns={["key", "value"]} rows={report.series.map((s) => ({ key: s.key, value: s.value }))} />
          : <AutoBarChart series={report.series} />
      )}

      {report.chartType === "line" && report.series && (
        asTable
          ? <TableView columns={["key", "value"]} rows={report.series.map((s) => ({ key: s.key, value: s.value }))} />
          : <LineChart series={report.series} />
      )}

      {report.chartType === "table" && report.tableRows && (
        <TableView columns={report.tableColumns ?? []} rows={report.tableRows} />
      )}
    </div>
  );
}
