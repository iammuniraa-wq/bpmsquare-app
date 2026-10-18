"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import type { ScheduleRow, ScheduleRowIssue } from "@/lib/estimator/schedule";

type Preview = {
  ok: boolean;
  row_count: number;
  rows: ScheduleRow[];
  errors: ScheduleRowIssue[];
  warnings: ScheduleRowIssue[];
  totals: { element_type: string; rule_code: string; rows: number; pieces: number; volume_m3: number; weight_t: number }[];
};

const SHOW_ROWS = 50;
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: c.hint, padding: "6px 10px", whiteSpace: "nowrap", background: c.panel2 };
const td: React.CSSProperties = { padding: "6px 10px", fontSize: 12.5, whiteSpace: "nowrap" };
const n3 = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-GB", { maximumFractionDigits: 3 }));

/** Element schedule (CSV or Excel from a BIM export): preview with row errors, then apply. */
export default function ScheduleImport({ estimateId, hasSchedule }: { estimateId: string; hasSchedule: boolean }) {
  const router = useRouter();
  const { confirm } = useFeel();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const url = `/api/estimates/${estimateId}/schedule`;

  async function send(mode: "preview" | "apply", skipErrors = false) {
    if (!file) return null;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${url}?mode=${mode}${skipErrors ? "&skip_errors=1" : ""}`, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  function choose(f: File | null) {
    setFile(f); setPreview(null); setError("");
    if (!f) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`${url}?mode=preview`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Could not read the file.");
      else setPreview(json as Preview);
    });
  }

  function apply(skipErrors: boolean) {
    setError("");
    startTransition(async () => {
      const r = await send("apply", skipErrors);
      if (!r) return;
      if (!r.res.ok) { setError(r.json.error ?? "Could not apply the schedule."); return; }
      setFile(null); setPreview(null); setOpen(false);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  async function clear() {
    if (!(await confirm({ title: "Remove the imported schedule?", body: "The estimate is recalculated from its formulas. Manual lines are kept.", tone: "danger" }))) return;
    startTransition(async () => {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) router.refresh();
      else { const j = await res.json().catch(() => ({})); setError(j.error ?? "Could not remove the schedule."); }
    });
  }

  if (!open) {
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Import schedule</Button>
        {hasSchedule && <Button variant="quiet" size="sm" loading={pending} onClick={clear}>Remove imported schedule</Button>}
        {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
      </div>
    );
  }

  return (
    <Card title="Import an element schedule" padding={18} action={<Button variant="quiet" size="sm" onClick={() => setOpen(false)}>Close</Button>}>
      <p className="bpm-t-help" style={{ marginTop: 0 }}>
        Upload a CSV or Excel file with one row per element type or mark (type, mark, count, length, width, thickness or height). Rows are matched to the template's element types and replace the formula quantities for those lines.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Button href={`/api/estimates/schedule-template?estimate_id=${estimateId}&format=xlsx`} variant="secondary" size="sm">Download template (Excel)</Button>
        <Button href={`/api/estimates/schedule-template?estimate_id=${estimateId}&format=csv`} variant="secondary" size="sm">Download template (CSV)</Button>
      </div>
      <input
        ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => choose(e.target.files?.[0] ?? null)} aria-label="Schedule file" disabled={pending}
        style={{ fontSize: 13, maxWidth: "100%" }}
      />
      {pending && !preview && <div className="bpm-t-help" style={{ marginTop: 8 }}>Reading the file…</div>}
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)", marginTop: 8 }}>{error}</div>}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>{preview.row_count}</strong> usable row{preview.row_count === 1 ? "" : "s"}
            {preview.errors.length > 0 && <>, <strong style={{ color: "var(--err-ink)" }}>{preview.errors.length} with problems</strong></>}
            {preview.warnings.length > 0 && <>, {preview.warnings.length} warning{preview.warnings.length === 1 ? "" : "s"}</>}.
          </div>
          {preview.totals.length > 0 && (
            <div className="bpm-t-help" style={{ marginBottom: 8 }}>
              {preview.totals.map((t) => `${t.element_type}: ${t.pieces} pcs, ${n3(t.volume_m3)} m³`).join(" · ")}
            </div>
          )}
          {preview.errors.length > 0 && (
            <ul role="alert" style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5, color: "var(--err-ink)" }}>
              {preview.errors.slice(0, 30).map((e, i) => <li key={i}>Row {e.row}{e.field ? ` (${e.field})` : ""}: {e.message}</li>)}
              {preview.errors.length > 30 && <li>…and {preview.errors.length - 30} more.</li>}
            </ul>
          )}
          {preview.warnings.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5, color: c.muted }}>
              {preview.warnings.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Row", "Type", "Mark", "Count", "Length", "Width", "Thick.", "Volume m³", "Feeds"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {preview.rows.slice(0, SHOW_ROWS).map((r) => (
                    <tr key={r.row} style={{ borderTop: `1px solid ${c.line}` }}>
                      <td style={td}>{r.row}</td><td style={td}>{r.element_type}</td><td style={td}>{r.mark ?? "—"}</td>
                      <td style={td}>{n3(r.count)}</td><td style={td}>{n3(r.length_m)}</td><td style={td}>{n3(r.width_m)}</td>
                      <td style={td}>{n3(r.thickness_m)}</td><td style={td}>{n3(r.volume_m3)}</td><td style={td}>{r.rule_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.rows.length > SHOW_ROWS && <div className="bpm-t-help" style={{ marginTop: 6 }}>Showing the first {SHOW_ROWS} of {preview.rows.length} rows.</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
            {preview.errors.length > 0 && preview.row_count > 0 && (
              <Button variant="secondary" loading={pending} onClick={() => apply(true)}>Apply the good rows only</Button>
            )}
            <Button variant="primary" loading={pending} disabled={preview.errors.length > 0 || preview.row_count === 0} onClick={() => apply(false)}>Apply schedule</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
