"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import EmptyState from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { ELEMENT_FIELDS, ELEMENT_FIELD_LABEL, type ElementField, type Quantity } from "@/lib/drawings/schedule";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import type { ElementRow } from "@/lib/drawings/types";
import { STATUS_LABEL } from "@/lib/drawings/types";
import { call } from "./api";
import { fmtNum, type RevisionView } from "./view";
import s from "./Drawings.module.css";

// The Elements tab: what a revision declares (read from a schedule), and, on a draft, the loader: drop a file, see what would be read
// (headers, the column map, the units, ten rows, warnings), confirm any unit the file does not state, then load. Nothing is fetched from
// anywhere: a person drops the file.

type Preview = {
  headers: string[]; map: Partial<Record<ElementField, string>>; sheet: string; sheets: string[];
  units: Record<Quantity, { unit: string; assumed: boolean }>; unitChoices: Record<Quantity, string[]>; confirmUnits: Quantity[];
  count: number; skipped: number; warnings: { row?: number; message: string }[]; sample: Partial<ElementRow>[];
};

export default function ElementsPanel({ drawingId, revisions, canEdit, isAdmin }: { drawingId: string; revisions: RevisionView[]; canEdit: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const feel = useFeel();
  const ordered = [...revisions].sort((a, b) => b.rev_no - a.rev_no);
  const open = ordered.find((r) => r.status === "draft") ?? ordered[0];
  const [revId, setRevId] = useState(open?.id ?? "");
  const rev = ordered.find((r) => r.id === revId) ?? open;
  const [rows, setRows] = useState<ElementRow[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<Partial<Record<ElementField, string>>>({});
  const [units, setUnits] = useState<Partial<Record<Quantity, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [saveMap, setSaveMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(100);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!revId) return;
    setRows(null);
    const r = await call<{ elements: ElementRow[] }>(`/api/drawings/${drawingId}/revisions/${revId}/elements`, "GET");
    setRows(r.ok ? r.data.elements : []);
  }, [drawingId, revId]);
  useEffect(() => { void load(); }, [load]);

  async function send(mode: "preview" | "load", f: File, m = map, u = units) {
    setBusy(true); setError("");
    const form = new FormData();
    form.set("file", f); form.set("mode", mode);
    form.set("map", JSON.stringify({ columns: m, units: u }));
    if (confirmed) form.set("confirm_units", "true");
    if (saveMap) form.set("save_map", "true");
    try {
      const res = await fetch(`/api/drawings/${drawingId}/revisions/${revId}/elements`, { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { setError(typeof json.error === "string" ? json.error : "The schedule could not be read"); return; }
      if (mode === "preview") {
        const p = json as unknown as Preview;
        setPreview(p); setMap(p.map);
        setUnits(Object.fromEntries(Object.entries(p.units).map(([q, x]) => [q, x.unit])) as Partial<Record<Quantity, string>>);
        setConfirmed(p.confirmUnits.length === 0);
      } else {
        feel.toast({ text: `${json.count as number} elements loaded`, tone: "success" });
        setPreview(null); setFile(null);
        await load();
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  if (!rev) return <EmptyState title="No revision yet" text="Start a revision first, then load its element schedule." />;
  const isDraft = rev.status === "draft" && canEdit && rev.canEdit;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className={s.toolbar}>
        <label className="bpm-t-label" htmlFor="el-rev">Revision</label>
        <Select id="el-rev" value={revId} onChange={(e) => { setRevId(e.target.value); setPreview(null); setFile(null); setShown(100); }} style={{ maxWidth: 240 }}>
          {ordered.map((r) => <option key={r.id} value={r.id}>{r.rev_label} ({STATUS_LABEL[r.status]})</option>)}
        </Select>
        <InfoTip label="Elements">{DRAWING_TIPS.elements}</InfoTip>
      </div>

      {isDraft && (
        <Card title="Load a schedule" info={DRAWING_TIPS.schedule} padding={14}>
          <input ref={input} type="file" accept=".xlsx,.csv" hidden data-guide="drawings.schedule_input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); void send("preview", f, {}, {}); } }} />
          <div className={s.actions}>
            <Button size="sm" onClick={() => input.current?.click()} loading={busy && !preview} data-guide="drawings.schedule_pick">{file ? "Choose another file" : "Choose an Excel or CSV schedule"}</Button>
            {file && <span className={s.quiet}>{file.name}</span>}
          </div>
          {error && <div role="alert" className={s.alert} style={{ marginTop: 10 }}>{error}</div>}

          {preview && (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div className={s.two}>
                <div>
                  <div className="bpm-t-label" style={{ marginBottom: 6 }}>Columns</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {ELEMENT_FIELDS.map((f) => (
                      <label key={f} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                        <span>{ELEMENT_FIELD_LABEL[f]}</span>
                        <Select value={map[f] ?? ""} onChange={(e) => { const next = { ...map }; if (e.target.value) next[f] = e.target.value; else delete next[f]; setMap(next); }}>
                          <option value="">Not in the file</option>
                          {preview.headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                        </Select>
                      </label>
                    ))}
                  </div>
                  <p className={s.quiet} style={{ fontSize: 12, margin: "8px 0 0" }}>Per piece <InfoTip label="Per piece">{DRAWING_TIPS.perPiece}</InfoTip></p>
                </div>
                <div>
                  <div className="bpm-t-label" style={{ marginBottom: 6 }}>Units <InfoTip label="Units">{DRAWING_TIPS.units}</InfoTip></div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {(Object.keys(preview.unitChoices) as Quantity[]).map((q) => (
                      <label key={q} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                        <span style={{ textTransform: "capitalize" }}>{q}{preview.confirmUnits.includes(q) ? " (assumed)" : ""}</span>
                        <Select value={units[q] ?? preview.units[q].unit} onChange={(e) => setUnits({ ...units, [q]: e.target.value })}>
                          {preview.unitChoices[q].map((u) => <option key={u} value={u}>{u}</option>)}
                        </Select>
                      </label>
                    ))}
                  </div>
                  {preview.confirmUnits.length > 0 && (
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13, minHeight: 44 }}>
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                      <span>These units are right</span>
                    </label>
                  )}
                  {isAdmin && (
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, minHeight: 44 }}>
                      <input type="checkbox" checked={saveMap} onChange={(e) => setSaveMap(e.target.checked)} />
                      <span>Keep these columns for this type</span> <InfoTip label="Keep columns">{DRAWING_TIPS.saveMap}</InfoTip>
                    </label>
                  )}
                </div>
              </div>

              <div className={s.actions}>
                <Button size="sm" onClick={() => file && send("preview", file)} loading={busy}>Check again</Button>
                <Button size="sm" variant="primary" disabled={!confirmed || busy} loading={busy} onClick={() => file && send("load", file)} data-guide="drawings.schedule_load">Load {preview.count} elements</Button>
                <span className={s.quiet} style={{ fontSize: 12.5 }}>{preview.skipped > 0 ? `${preview.skipped} rows skipped. ` : ""}Sheet {preview.sheet}</span>
              </div>
              {preview.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--amberink)" }}>
                  {preview.warnings.slice(0, 6).map((w, i) => <li key={i}>{w.row ? `Row ${w.row}: ` : ""}{w.message}</li>)}
                  {preview.warnings.length > 6 && <li>and {preview.warnings.length - 6} more</li>}
                </ul>
              )}
              <ElementTable rows={preview.sample as ElementRow[]} caption="First rows that would be loaded" />
            </div>
          )}
        </Card>
      )}

      <Card title={`Elements of revision ${rev.rev_label}`} padding={14}>
        {rows === null ? <p className={s.quiet}>Loading</p> : rows.length === 0 ? (
          <EmptyState title="No elements loaded" text={isDraft ? "Load a schedule exported from the model to compare this revision with the last release." : "This revision declares no elements."} />
        ) : (
          <>
            <ElementTable rows={rows.slice(0, shown)} />
            {rows.length > shown && <div style={{ marginTop: 10 }}><Button size="sm" onClick={() => setShown((n) => n + 400)}>Show more ({rows.length - shown} left)</Button></div>}
          </>
        )}
      </Card>
    </div>
  );
}

function ElementTable({ rows, caption }: { rows: Partial<ElementRow>[]; caption?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        {caption && <caption style={{ textAlign: "left", padding: "6px 10px", fontSize: 12, color: "var(--hint)" }}>{caption}</caption>}
        <thead><tr><th>Code</th><th>Type</th><th>Building</th><th>Level</th><th className={s.num}>Pieces</th><th className={s.num}>m3</th><th className={s.num}>t</th></tr></thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.id ?? `${e.element_code}-${i}`}>
              <td>{e.element_code ?? e.model_uid ?? ""}</td><td>{e.element_type ?? ""}</td><td>{e.building ?? ""}</td><td>{e.level ?? ""}</td>
              <td className={s.num}>{fmtNum(e.qty, 3)}</td><td className={s.num}>{fmtNum(e.volume_m3, 3)}</td>
              <td className={s.num} title={e.weight_calculated ? "Calculated from the volume" : undefined}>{fmtNum(e.weight_t, 3)}{e.weight_calculated ? " (calc.)" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
