"use client";

import { useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import Card from "@/components/ui/Card";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { BOQ_FIELDS, FIELD_LABEL, colLetter, type BoqField, type ColumnMap } from "@/lib/tender/boq/parse";

// Upload BOQ, on the Bill of quantities toolbar (GCC tender deals): pick the client's Excel, check how it was read (sheet, header row,
// columns), see what a revised file changes, then apply. The button sits in the toolbar and the check opens as a card above the table.
// Writes go to /api/opportunities/[id]/boq; the workspace and the deal are the server's, not this component's.

type Preview = {
  sheets: string[]; sheet: string; header_row: number | null; map: ColumnMap; headers: { col: number; label: string }[]; preview: string[][];
  reused_map: boolean; needs_mapping: boolean; line_count: number; sample: { row_no: number; item_no: string | null; description: string; qty: number; uom: string | null }[];
  skipped_count: number; total_row: number | null; truncated: boolean; columns: { added: boolean } | null;
  diff: { added: number; changed: number; unchanged: number; dropped: number; kept: number; added_items: string[]; changed_items: { item: string; fields: string[] }[]; dropped_items: string[]; kept_items: string[] } | null;
};
type Choice = { sheet: string; header_row: string; map: ColumnMap };

export function useBoqUpload({ base, hasBoq, onError, onNotice, onApplied }: {
  /** /api/opportunities/[id]/boq */
  base: string;
  /** The deal already has a BOQ, so this is a revised file. */
  hasBoq: boolean;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  /** Called after the lines were created or updated, so the table and the page reload. */
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function send(f: File, ch: Choice | null, apply: boolean) {
    const form = new FormData();
    form.set("file", f);
    if (ch) {
      form.set("sheet", ch.sheet);
      if (ch.header_row) form.set("header_row", ch.header_row);
      // An empty map means "read the columns again from the header row"; the server then detects them.
      if (Object.keys(ch.map).length > 0) form.set("map", JSON.stringify(ch.map));
    }
    return fetch(apply ? base : `${base}/preview`, { method: "POST", body: form });
  }

  async function pick(f: File | null) {
    onError(""); onNotice("");
    if (!f) return;
    setBusy(true);
    const res = await send(f, null, false);
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "The file could not be read"); setFile(null); setPreview(null); return; }
    setFile(f); setPreview(j as Preview);
    setChoice({ sheet: j.sheet, header_row: j.header_row ? String(j.header_row) : "", map: j.map });
  }

  async function reread(next: Choice) {
    if (!file) return;
    setChoice(next);
    setBusy(true);
    // A new header row with no map chosen yet lets the server detect the columns again.
    const res = await send(file, { ...next, map: next.map }, false);
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "Could not read it with that choice"); return; }
    onError("");
    setPreview(j as Preview);
    setChoice({ sheet: j.sheet, header_row: j.header_row ? String(j.header_row) : next.header_row, map: j.map });
  }

  function cancel() {
    setFile(null); setPreview(null); setChoice(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function apply() {
    if (!file || !choice) return;
    setBusy(true); onError("");
    const res = await send(file, choice, true);
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "Could not save the BOQ"); return; }
    onNotice(`BOQ saved: ${j.line_count} lines${j.added || j.changed || j.dropped || j.kept ? ` (${j.added} added, ${j.changed} changed, ${j.dropped} removed, ${j.kept} kept)` : ""}`);
    cancel();
    onApplied();
  }

  const button = (
    <>
      <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-guide="boq.file" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      <Button variant={hasBoq ? "secondary" : "primary"} loading={busy && !preview} onClick={() => fileInput.current?.click()} style={{ minHeight: 44 }} data-guide="boq.upload">{hasBoq ? "Upload revised BOQ" : "Upload BOQ (.xlsx)"}</Button>
      <InfoTip label="Upload">{hasBoq ? TENDER_TIPS.boqReupload : TENDER_TIPS.boqUpload}</InfoTip>
    </>
  );

  const panel = preview && choice ? (
    <Card title="How the file was read" info={TENDER_TIPS.boqMapping}>
      <div data-guide="boq.preview" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {preview.reused_map && <span style={{ fontSize: 11.5, color: c.hint }}>Same layout as last time</span>}
        <div className="fg2">
          {preview.sheets.length > 1 && (
            <Field label="Sheet" guide="boq.sheet">
              <Select value={choice.sheet} onChange={(e) => void reread({ sheet: e.target.value, header_row: "", map: {} })}>
                {preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Header row" guide="boq.header_row">
            <Input type="number" min={1} inputMode="numeric" value={choice.header_row} onChange={(e) => setChoice({ ...choice, header_row: e.target.value })} onBlur={() => choice.header_row && void reread({ ...choice, map: {} })} />
          </Field>
          {BOQ_FIELDS.map((f: BoqField) => (
            <Field key={f} label={FIELD_LABEL[f]} guide={`boq.map.${f}`}>
              <Select value={choice.map[f] ?? ""} onChange={(e) => {
                const map = { ...choice.map }; if (e.target.value) map[f] = Number(e.target.value); else delete map[f];
                void reread({ ...choice, map });
              }}>
                <option value="">— none —</option>
                {preview.headers.map((h) => <option key={h.col} value={h.col}>{colLetter(h.col)}{h.label ? ` · ${h.label.slice(0, 28)}` : ""}</option>)}
              </Select>
            </Field>
          ))}
        </div>

        {preview.needs_mapping ? (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--redink)" }}>No header row was found. Enter the row number of the header, then choose the Description and Quantity columns.</div>
        ) : (
          <div style={{ fontSize: 12.5, color: c.ink }}>
            {preview.line_count} lines found{preview.skipped_count ? ` · ${preview.skipped_count} rows skipped (headings, totals)` : ""}{preview.truncated ? " · only the first 2,000 are read" : ""}
          </div>
        )}
        {preview.columns?.added && (
          <div style={{ fontSize: 12.5, color: "var(--amberink)", display: "flex", alignItems: "center", gap: 6 }} data-guide="boq.added_columns">
            Rate and amount columns will be added after the last column of the file <InfoTip label="Added columns">{TENDER_TIPS.boqAddedColumns}</InfoTip>
          </div>
        )}
        {preview.sample.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: c.muted }}>
            {preview.sample.map((s) => <div key={s.row_no} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.item_no ?? "·"} {s.description} — {s.qty} {s.uom ?? ""}</div>)}
          </div>
        )}
        {preview.diff && (
          <div data-guide="boq.diff" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
            <div style={{ fontWeight: 700, color: c.ink }}>Compared with the BOQ on the deal</div>
            <div>{preview.diff.added} added · {preview.diff.changed} changed · {preview.diff.unchanged} unchanged · {preview.diff.dropped} removed{preview.diff.kept ? ` · ${preview.diff.kept} priced kept` : ""}</div>
            {preview.diff.changed_items.slice(0, 6).map((x) => <div key={x.item} style={{ color: c.muted }}>Changed: {x.item} ({x.fields.join(", ")})</div>)}
            {preview.diff.added_items.slice(0, 4).map((x) => <div key={x.slice(0, 40) + "a"} style={{ color: c.muted }}>Added: {x}</div>)}
            {preview.diff.dropped_items.slice(0, 4).map((x) => <div key={x.slice(0, 40) + "d"} style={{ color: c.muted }}>Removed (unpriced): {x}</div>)}
            {preview.diff.kept_items.map((x) => <div key={x.slice(0, 40) + "k"} style={{ color: "var(--amberink)" }}>Kept, no longer in the file: {x}</div>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" disabled={preview.needs_mapping || busy} loading={busy} onClick={() => void apply()} style={{ minHeight: 44 }} data-guide="boq.apply">{hasBoq ? "Update the deal lines" : "Create the deal lines"}</Button>
          <Button variant="secondary" disabled={busy} onClick={cancel} style={{ minHeight: 44 }} data-guide="boq.cancel">Cancel</Button>
        </div>
      </div>
    </Card>
  ) : null;

  return { button, panel, open: !!preview };
}
