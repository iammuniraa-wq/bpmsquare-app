"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import type { ScheduleSimulation } from "@/lib/estimator/simulation";
import type { ScheduleGap } from "./scheduleState";

const GAP_TEXT: Record<ScheduleGap, string> = {
  no_layout: "This template has no layout to take a concrete volume from, so it has no build schedule. The risk run below still works from its rates.",
  calculate: "The schedule is built from the concrete volume of the model, which this estimate does not have stored yet.",
  locked: "This estimate has a quote or is read-only, so its model cannot be calculated again here.",
  unsaved: "The schedule is built from the concrete volume of the model. Fill in the details on the Estimate tab first.",
};

function Calculate({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/calculate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not calculate the estimate."); return; }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
      <Button variant="primary" size="sm" loading={busy} onClick={run}>Calculate</Button>
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
    </div>
  );
}

// Bars carry their own text (days and day range) and a distinct fill, so the
// chart never relies on colour alone.
const FILL: Record<string, string> = { casting: "var(--accent)", transport: "var(--amberc)", erection: "var(--teal)" };

export default function ScheduleCard({ schedule, volume, gap, estimateId }: { schedule: ScheduleSimulation; volume: number; gap: ScheduleGap; estimateId?: string }) {
  if (!schedule.available) {
    return (
      <Card title="Schedule" padding={16}>
        <EmptyState title={gap === "no_layout" ? "No build schedule for this template" : "Nothing to schedule yet"} text={GAP_TEXT[gap]}
          action={gap === "calculate" && estimateId ? <Calculate estimateId={estimateId} /> : undefined} />
      </Card>
    );
  }
  const total = Math.max(1, schedule.total_days);
  return (
    <Card title="Schedule" padding={18}>
      <p className="bpm-t-body" style={{ margin: "0 0 12px" }}>
        About <b>{schedule.total_days} working days</b> from the first casting to the last panel in place
        ({volume.toLocaleString("en-GB", { maximumFractionDigits: 0 })} m³ of concrete, {schedule.loads} truck loads).
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {schedule.bars.map((b) => (
          <li key={b.key} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 170px) minmax(0, 1fr)", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--ink)" }}>{b.label}</span>
            <div>
              <div role="img" aria-label={`${b.label}: day ${b.start + 1} to day ${b.end}, ${b.days} days`}
                style={{ position: "relative", height: 18, background: "var(--panel2)", borderRadius: 6, border: "1px solid var(--line)" }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0, left: `${(b.start / total) * 100}%`, width: `${Math.max(1.5, ((b.end - b.start) / total) * 100)}%`,
                  borderRadius: 5, background: FILL[b.key] ?? "var(--accent)", backgroundImage: b.key === "transport" ? "repeating-linear-gradient(45deg, transparent 0 5px, rgba(255,255,255,0.35) 5px 8px)" : undefined,
                }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Day {b.start + 1} to {b.end}, {b.days} {b.days === 1 ? "day" : "days"}</div>
            </div>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Scale: day 1 to day {total}.</div>

      <h3 className="bpm-t-label" style={{ margin: "16px 0 6px" }}>Capacity assumptions</h3>
      <div className="bpm-t-help" style={{ marginBottom: 6 }}>
        These are rates of the estimate template (Settings, Estimate templates, Rates). Edit them there to re-run the schedule; where the template has none, the default is used.
      </div>
      <dl style={{ margin: 0 }}>
        {schedule.assumptions.map((a) => (
          <div key={a.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderTop: "1px solid var(--line)", fontSize: 13 }}>
            <dt style={{ color: "var(--muted)" }}>{a.label}</dt>
            <dd style={{ margin: 0, color: "var(--ink)", fontWeight: 600 }}>
              {a.value} {a.unit} <span style={{ fontWeight: 400, color: "var(--hint)" }}>({a.source === "template" ? "template rate" : "default"})</span>
            </dd>
          </div>
        ))}
      </dl>
      {schedule.warnings.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--err-ink)" }}>{schedule.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
    </Card>
  );
}
