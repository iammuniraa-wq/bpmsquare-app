"use client";

import { useEffect, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

type Row = {
  key: string; net_minutes: number; gross_minutes: number; break_minutes: number; sessions: number; employees: number;
  own_minutes: number; total_minutes: number; employees_total: number;
};

const RANGES = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 90 days" },
  { key: "all", label: "Last 12 months" },
] as const;

function rangeFor(key: (typeof RANGES)[number]["key"]): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (key === "month") return { from: `${to.slice(0, 7)}-01`, to };
  const days = key === "quarter" ? 90 : 365;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10), to };
}

/** h:mm, never decimal hours — see the payroll export's own note. */
function fmtHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const tile: React.CSSProperties = { flex: "1 1 150px", minWidth: 150 };
const tileValue: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" };
const tileLabel: React.CSSProperties = { fontSize: 11.5, color: c.hint, marginTop: 2 };

export default function ProjectHoursPanel({
  projectId, budgetHours,
}: {
  projectId: string;
  budgetHours: number | null;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("month");
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const { from, to } = rangeFor(range);
    setLoading(true);
    fetch(`/api/wfm/projects/hours?from=${from}&to=${to}&project_id=${projectId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setError(j.error ?? "Could not load hours"); return; }
        setError("");
        // The report lists the whole subtree; this panel is about THIS row,
        // rolled up -- a project whose work all sits on its sub-projects is
        // not "0h", it is the sum of them.
        const rows: Row[] = j.rows ?? [];
        setRow(rows.find((r) => r.key === projectId) ?? null);
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, [projectId, range]);

  const worked = row?.total_minutes ?? row?.net_minutes ?? 0;
  const people = row?.employees_total ?? row?.employees ?? 0;
  const rolledUp = !!row && row.total_minutes > row.own_minutes;
  // Budget is hours; worked is minutes. Only shown when a budget was set --
  // an unset budget must not render as "0% of 0".
  const pct = budgetHours && budgetHours > 0 ? Math.round((worked / 60 / budgetHours) * 100) : null;
  const over = pct != null && pct > 100;

  return (
    <div style={{ ...cardStyle, padding: 18 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {RANGES.map((r) => {
          const on = range === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              style={{
                fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer",
                color: on ? c.accent : c.muted,
                background: on ? c.accentbg : c.panel2,
                border: `1px solid ${on ? c.accent + "60" : c.line}`,
                borderRadius: 6, padding: "5px 12px",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div style={{ fontSize: 12.5, color: statusInk.bad }}>{error}</div>
      ) : loading ? (
        <div style={{ fontSize: 12.5, color: c.hint }}>Loading hours…</div>
      ) : !row ? (
        <div style={{ fontSize: 13, color: c.hint }}>
          No hours booked to this project in this period.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={tile}>
            <div style={tileValue}>{fmtHM(worked)}</div>
            <div style={tileLabel}>worked{rolledUp ? " · incl. sub-projects" : ""}</div>
          </div>
          <div style={tile}>
            <div style={tileValue}>{people}</div>
            <div style={tileLabel}>{people === 1 ? "person" : "people"}</div>
          </div>
          {row.sessions > 0 && (
            <div style={tile}>
              <div style={tileValue}>{row.sessions}</div>
              <div style={tileLabel}>work sessions{rolledUp ? " on it directly" : ""}</div>
            </div>
          )}
          {row.break_minutes > 0 && (
            <div style={tile}>
              <div style={{ ...tileValue, color: c.muted }}>{fmtHM(row.break_minutes)}</div>
              <div style={tileLabel}>breaks</div>
            </div>
          )}
          {pct != null && (
            <div style={tile}>
              <div style={{ ...tileValue, color: over ? statusInk.bad : statusInk.good }}>{pct}%</div>
              <div style={tileLabel}>of {budgetHours}h budget{over ? " — over" : ""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
