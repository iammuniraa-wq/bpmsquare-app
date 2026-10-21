"use client";

import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import Pill from "@/components/Pill";
import { fmtDateTime } from "@/components/rfq/rfqUi";
import { D365_ENTITY_LABEL, type D365EntityKey } from "@/lib/connectors/d365/types";
import { COUNT_KEYS, isLiveRun, type D365Run } from "@/lib/connectors/d365/runSummary";
import { D365_TIPS } from "@/lib/connectors/d365/tips";

const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", color: c.hint, background: c.panel2, fontWeight: 600 };
const COLS = ["When", "What", "Result", "Read", "New", "Updated", "Unchanged", "Skipped", "Failed"];
const entityName = (e: string) => D365_ENTITY_LABEL[e as D365EntityKey] ?? e;
const tone = (s: string) => (s === "succeeded" ? "green" : s === "partial" ? "amber" : s === "failed" ? "red" : "blue") as "green" | "amber" | "red" | "blue";

function Spinner({ label }: { label: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: c.muted }}><span className="bpm-spin" aria-hidden="true" />{label}</span>;
}

/**
 * Run history. `pending` lists the actions in flight (a spinner row each,
 * unless that entity already has a live run in the list); the parent keeps
 * `runs` fresh (see useD365Runs). Plain props only, so any screen can mount it.
 */
export default function D365Runs({ runs, pending = [], loading = false, onRefresh }: {
  runs: D365Run[];
  pending?: { entity: string; label: string }[];
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const now = Date.now();
  const spinning = pending.filter((p) => !runs.some((r) => r.entity === p.entity && isLiveRun(r, now)));
  const empty = runs.length === 0 && spinning.length === 0;

  return (
    <Card padding={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderBottom: `1px solid ${c.line}` }}>
        <span className="bpm-label-row" style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>
          Recent runs
          <InfoTip label="Recent runs">{D365_TIPS.runs}</InfoTip>
        </span>
        {onRefresh && <Button size="sm" variant="quiet" onClick={onRefresh}>Refresh</Button>}
      </div>

      {empty ? (
        <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>{loading ? "Loading…" : "No runs yet. Run a sync and it shows here."}</div>
      ) : (
        <>
          <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{COLS.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody aria-live="polite">
                {spinning.map((p) => (
                  <tr key={`pending-${p.entity}`} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td colSpan={COLS.length} style={{ padding: "8px 12px" }}><Spinner label={p.label} /></td>
                  </tr>
                ))}
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${c.line}`, verticalAlign: "top" }}>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: c.muted }}>{fmtDateTime(r.started_at)}{r.trigger === "schedule" ? " · auto" : ""}</td>
                    <td style={{ padding: "8px 12px", color: c.ink }}>{entityName(r.entity)}</td>
                    <td style={{ padding: "8px 12px" }}><RunResult r={r} now={now} /></td>
                    {COUNT_KEYS.map((k) => <td key={k} style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", color: c.muted }}>{r.counts?.[k] ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bpm-rows-cards" style={{ gap: 8, padding: 10 }} aria-live="polite">
            {spinning.map((p) => <div key={`pending-${p.entity}`} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5 }}><Spinner label={p.label} /></div>)}
            {runs.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: c.ink, fontWeight: 600 }}>{entityName(r.entity)}</span>
                  <span style={{ color: c.hint }}>{fmtDateTime(r.started_at)}{r.trigger === "schedule" ? " · auto" : ""}</span>
                </div>
                <RunResult r={r} now={now} />
                <div style={{ color: c.muted, fontVariantNumeric: "tabular-nums" }}>{COUNT_KEYS.map((k) => `${r.counts?.[k] ?? 0} ${k}`).join(" · ")}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function RunResult({ r, now }: { r: D365Run; now: number }) {
  const live = isLiveRun(r, now);
  return (
    <div>
      {live ? <Spinner label="Running" /> : <Pill label={r.status} tone={tone(r.status)} />}
      {r.error && <div style={{ color: "var(--redink)", marginTop: 4, maxWidth: 360 }}>{r.error}</div>}
      {r.issues?.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", color: c.muted }}>{r.issues.length} note{r.issues.length === 1 ? "" : "s"}</summary>
          <ul style={{ margin: "4px 0 0 16px", padding: 0, color: c.muted }}>{r.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
