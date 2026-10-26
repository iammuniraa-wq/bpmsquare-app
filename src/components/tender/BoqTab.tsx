"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import Card from "@/components/ui/Card";
import Tabs from "@/components/ui/Tabs";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { BOQ_FIELDS, FIELD_LABEL, colLetter, type BoqField, type ColumnMap } from "@/lib/tender/boq/parse";
import { PRICE_SOURCE_LABEL, rateFor, type PriceSource } from "@/lib/tender/boq/price";
import BoqMatch from "./BoqMatch";
import { LineEstimates } from "./BoqEstimates";
import { AllocatePanel, EstimateAttention } from "./BoqEstimatePanels";
import { reloadAfterSave } from "./refreshAfterSave";
import type { EstimatesState } from "@/lib/tender/estimates/server";

// The BOQ tab of a tender deal (slice 3a): upload the client's Excel, check how it was read, price each line from a source that
// says how old it is, and download the client's own file back with the rates in it. Everything the person needs to decide is
// on the screen; every explanation is behind an "i". Writes go to /api/opportunities/[id]/boq/*; the workspace and the deal are
// the server's, not this component's.

type Line = {
  id: string; line_id: string | null; row_no: number; item_no: string | null; cost_code: string | null; description: string; uom: string | null; qty: number;
  rate: number; amount: number; priced: boolean; linked: boolean; removed: boolean;
  price_source: PriceSource | null; price_source_ref: string | null; price_as_of: string | null;
  stale: boolean; stale_text: string | null; stale_accepted: boolean; unit_cost: number | null; markup_pct: number | null;
};
type State = {
  pending: boolean;
  source: { file_name: string; sheet_name: string; version: number; uploaded_at: string; line_count: number; added_columns: boolean } | null;
  lines: Line[]; validity_days: number; today: string;
  totals: { lines: number; priced: number; unpriced: number; stale: number; amount: number; no_product?: number };
  unpriced: { item: string; reason: string }[];
};
type Preview = {
  sheets: string[]; sheet: string; header_row: number | null; map: ColumnMap; headers: { col: number; label: string }[]; preview: string[][];
  reused_map: boolean; needs_mapping: boolean; line_count: number; sample: { row_no: number; item_no: string | null; description: string; qty: number; uom: string | null }[];
  skipped_count: number; total_row: number | null; truncated: boolean; columns: { added: boolean } | null;
  diff: { added: number; changed: number; unchanged: number; dropped: number; kept: number; added_items: string[]; changed_items: { item: string; fields: string[] }[]; dropped_items: string[]; kept_items: string[] } | null;
};
type Cand = { source: Exclude<PriceSource, "manual">; ref: string; label: string; price: number; kind: "cost" | "sell"; as_of: string | null; stale: boolean; stale_text: string | null };

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date");
const PAGE = 25;

export type BoqScreenState = State;

// Three named sections, kept in ?boq= so a reload or a shared link lands on the same one. Prices is where people work once a BOQ exists;
// with no BOQ yet there is only Upload.
const BOQ_TABS = ["upload", "prices", "download"] as const;

export default function BoqTab({ opportunityId, canEdit, onError, onNotice, onLinesChanged, initialData, initialEstimates }: {
  opportunityId: string; canEdit: boolean; onError: (m: string) => void; onNotice: (m: string) => void;
  /** Called after anything that changed the deal's lines (create, re-upload, a price), so the page can reload the Lines tab and the header. */
  onLinesChanged?: () => void;
  /** Lets a server render (and its test) show the loaded screen without a fetch. The page never passes it. */
  initialData?: State;
  initialEstimates?: EstimatesState & { rfq_enabled?: boolean };
}) {
  const { confirm } = useFeel();
  const base = `/api/opportunities/${opportunityId}/boq`;
  // The estimate tools have their own folder (they are gated by the estimator as well as the tender BOQ).
  const estimatesBase = `/api/opportunities/${opportunityId}/tender/estimates`;
  const [data, setData] = useState<State | null>(initialData ?? null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choice, setChoice] = useState<{ sheet: string; header_row: string; map: ColumnMap } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [markup, setMarkup] = useState("0");
  const [manual, setManual] = useState("");
  const [left, setLeft] = useState<{ id: string; item: string; reason: string }[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useUrlTab(BOQ_TABS, "boq", "prices");

  // Estimates that price the lines (slice 3c-1). A 404 (no estimator, no view of it, migration pending) means the screen simply does not
  // offer them: the BOQ works exactly as it did.
  const [est, setEst] = useState<(EstimatesState & { rfq_enabled?: boolean }) | null>(initialEstimates ?? null);

  const load = useCallback(async () => {
    const res = await fetch(base);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { onError(j.error ?? "Could not load the BOQ"); return; }
    setData(j as State);
  }, [base, onError]);
  useEffect(() => { void load(); }, [load]);

  const loadEstimates = useCallback(async () => {
    try {
      const res = await fetch(`${estimatesBase}/links`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      setEst(res.ok && !j.pending ? (j as EstimatesState & { rfq_enabled?: boolean }) : null);
    } catch { setEst(null); }
  }, [estimatesBase]);
  useEffect(() => { if (!initialEstimates) void loadEstimates(); }, [loadEstimates, initialEstimates]);

  // After anything that changed a rate through an estimate: the BOQ, the estimate state and the page's lines reload, in that order of need.
  const estimatesChanged = useCallback(() => {
    void reloadAfterSave<State>(base, setData, onLinesChanged);
    void loadEstimates();
  }, [base, loadEstimates, onLinesChanged]);

  async function send(f: File, ch: NonNullable<typeof choice> | null, apply: boolean) {
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
    onError(""); onNotice(""); setLeft(null);
    if (!f) return;
    setBusy(true);
    const res = await send(f, null, false);
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "The file could not be read"); setFile(null); setPreview(null); return; }
    setFile(f); setPreview(j as Preview); setTab("upload");
    setChoice({ sheet: j.sheet, header_row: j.header_row ? String(j.header_row) : "", map: j.map });
  }

  async function reread(next: NonNullable<typeof choice>) {
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

  async function apply() {
    if (!file || !choice) return;
    setBusy(true); onError("");
    const res = await send(file, choice, true);
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "Could not save the BOQ"); return; }
    onNotice(`BOQ saved: ${j.line_count} lines${j.added || j.changed || j.dropped || j.kept ? ` (${j.added} added, ${j.changed} changed, ${j.dropped} removed, ${j.kept} kept)` : ""}`);
    setFile(null); setPreview(null); setChoice(null);
    if (fileInput.current) fileInput.current.value = "";
    await load();
    onLinesChanged?.();
    setTab("prices");
  }

  async function openPicker(l: Line) {
    if (openLine === l.id) { setOpenLine(null); return; }
    setOpenLine(l.id); setCands(null); setManual("");
    const res = await fetch(`${base}/candidates?line=${l.id}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { onError(j.error ?? "Could not load the prices"); return; }
    setCands(j.candidates as Cand[]);
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true); onError("");
    const res = await fetch(`${base}/price`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "Could not set the price"); return null; }
    await load();
    onLinesChanged?.();
    return j;
  }

  async function choose(l: Line, cd: Cand) {
    if (cd.stale && !(await confirm({ title: "Use a stale price?", body: `${cd.label} is ${cd.stale_text}. Your workspace treats prices older than ${data?.validity_days} days as out of date. Use it anyway?`, confirmLabel: "Use it knowingly" }))) return;
    const j = await post({ line: l.id, source: cd.source, ref: cd.ref, markup_pct: Number(markup) || 0, accept_stale: cd.stale });
    if (j) { setOpenLine(null); onNotice("Price set"); }
  }

  async function priceAll() {
    const j = await post({ all: true, markup_pct: Number(markup) || 0 });
    if (!j) return;
    setLeft(j.left_count > 0 ? j.left : null);
    onNotice(`${j.priced} line${j.priced === 1 ? "" : "s"} priced${j.left_count ? `, ${j.left_count} left` : ""}`);
  }

  async function download(kind: "priced" | "answer") {
    if (!data) return;
    if (kind === "priced" && data.totals.unpriced > 0) {
      const names = data.unpriced.slice(0, 10).map((u) => `${u.item} (${u.reason})`).join("\n");
      const more = data.totals.unpriced > 10 ? `\n…and ${data.totals.unpriced - 10} more` : "";
      if (!(await confirm({ title: `${data.totals.unpriced} line${data.totals.unpriced === 1 ? " has" : "s have"} no rate`, body: `They are left blank in the file.\n${names}${more}`, confirmLabel: "Download anyway" }))) return;
    }
    window.location.assign(`${base}/export?kind=${kind}`);
  }

  if (!data) return <div style={{ fontSize: 13, color: c.hint }}>Loading the BOQ…</div>;
  if (data.pending) {
    return <div role="alert" data-guide="boq.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>The BOQ needs a database update (migration 0223). Ask your administrator to apply it.</div>;
  }

  const active = data.lines.filter((l) => !l.removed);
  const flagged = data.lines.filter((l) => l.removed);
  const shown = showAll ? active : active.slice(0, PAGE);

  // With no BOQ yet there is only Upload. A count on a tab says it needs attention: a file read but not saved on Upload, lines without a
  // rate (or with a stale one) on Prices.
  const view: (typeof BOQ_TABS)[number] = data.source ? tab as (typeof BOQ_TABS)[number] : "upload";
  const tabs = [
    { id: "upload", label: "Upload", count: preview ? 1 : 0 },
    ...(data.source ? [{ id: "prices", label: "Prices", count: data.totals.unpriced + data.totals.stale }, { id: "download", label: "Download" }] : []),
  ];

  return (
    <div data-guide="boq.tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tabs.length > 1 && <Tabs tabs={tabs} value={view} onChange={setTab} label="BOQ sections" />}
      {view === "upload" && (
      <Card title="Client's BOQ" info={TENDER_TIPS.boqTab}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {canEdit && (
            <>
              <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-guide="boq.file" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
              <Button variant="primary" loading={busy && !preview} onClick={() => fileInput.current?.click()} style={{ minHeight: 44 }} data-guide="boq.upload">{data.source ? "Upload revised BOQ" : "Upload BOQ (.xlsx)"}</Button>
              <InfoTip label="Upload">{data.source ? TENDER_TIPS.boqReupload : TENDER_TIPS.boqUpload}</InfoTip>
            </>
          )}
          {data.source && <span style={{ fontSize: 12, color: c.hint, overflowWrap: "anywhere" }}>{data.source.file_name} · {data.source.sheet_name} · version {data.source.version} · {fmtDate(data.source.uploaded_at)}</span>}
        </div>

        {preview && choice && (
          <div data-guide="boq.preview" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: c.ink }}>
              How the file was read <InfoTip label="Mapping">{TENDER_TIPS.boqMapping}</InfoTip>
              {preview.reused_map && <span style={{ fontSize: 11, fontWeight: 500, color: c.hint }}>same layout as last time</span>}
            </div>
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
              <Button variant="primary" disabled={preview.needs_mapping || busy} loading={busy} onClick={() => void apply()} style={{ minHeight: 44 }} data-guide="boq.apply">{data.source ? "Update the deal lines" : "Create the deal lines"}</Button>
              <Button variant="secondary" disabled={busy} onClick={() => { setFile(null); setPreview(null); setChoice(null); if (fileInput.current) fileInput.current.value = ""; }} style={{ minHeight: 44 }} data-guide="boq.cancel">Cancel</Button>
            </div>
          </div>
        )}
      </Card>
      )}

      {data.source && view === "prices" && (
        <Card title="Lines and prices">
          <div style={{ marginBottom: 12 }}>
            <StatStrip guide="boq.summary">
              <StatTile tone={data.totals.unpriced > 0 ? "warn" : "good"} label="Priced" value={`${data.totals.priced} of ${data.totals.priced + data.totals.unpriced}`} sub={data.totals.unpriced > 0 ? `${data.totals.unpriced} to price` : "all lines priced"} />
              <StatTile tone="info" label="Total" value={money(data.totals.amount)} sub="priced lines" />
              <StatTile tone={data.totals.stale > 0 ? "warn" : "neutral"} label="Stale prices" value={String(data.totals.stale)} sub={data.totals.stale > 0 ? `older than ${data.validity_days} days` : "none out of date"} />
              <StatTile tone={(data.totals.no_product ?? 0) > 0 ? "warn" : "neutral"} label="Without a product" value={String(data.totals.no_product ?? 0)} sub={(data.totals.no_product ?? 0) > 0 ? "match them below" : "all matched"} />
            </StatStrip>
          </div>
          <BoqMatch base={base} count={data.totals.no_product ?? 0} canEdit={canEdit} onError={onError} onNotice={onNotice} onChanged={() => { void load(); onLinesChanged?.(); }} />
          {est && (
            <>
              <EstimateAttention opportunityId={opportunityId} base={estimatesBase} state={est} canEdit={canEdit} markup={Number(markup) || 0} rfqEnabled={est.rfq_enabled === true} onChanged={estimatesChanged} onError={onError} onNotice={onNotice} />
              {canEdit && <AllocatePanel base={estimatesBase} state={est} canEdit={canEdit} markup={Number(markup) || 0} onChanged={estimatesChanged} onError={onError} onNotice={onNotice} />}
            </>
          )}
          {canEdit && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
              <Field label="Markup on cost %" info={TENDER_TIPS.boqMarkup} guide="boq.markup">
                <Input type="number" min={0} step="0.5" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} style={{ width: 110 }} />
              </Field>
              <Button variant="primary" loading={busy} disabled={data.totals.unpriced === 0} onClick={() => void priceAll()} style={{ minHeight: 44 }} data-guide="boq.price_all">Price all lines</Button>
              <InfoTip label="Price all">{TENDER_TIPS.boqPriceAll}</InfoTip>
            </div>
          )}
          {(Number(markup) || 0) === 0 && canEdit && (
            <div style={{ fontSize: 12, color: "var(--amberink)", marginBottom: 8 }}>Markup is 0%: supplier and BOM prices are used at cost.</div>
          )}
          {left && (
            <div role="status" data-guide="boq.left" style={{ fontSize: 12.5, color: "var(--amberink)", marginBottom: 10, display: "flex", flexDirection: "column", gap: 2 }}>
              <b>Left unpriced</b>
              {left.slice(0, 20).map((x) => <div key={x.id}>{x.item}: {x.reason}</div>)}
              {left.length > 20 && <div>…and {left.length - 20} more</div>}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column" }}>
            {shown.map((l) => (
              <div key={l.id} data-guide="boq.line" style={{ borderTop: `1px solid ${c.line}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: c.ink, minWidth: 40 }}>{l.item_no ?? `#${l.row_no}`}</span>
                  <span style={{ flex: "1 1 220px", fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{l.description}</span>
                  <span style={{ fontSize: 12, color: c.muted, whiteSpace: "nowrap" }}>{l.qty} {l.uom ?? ""}{l.cost_code ? ` · ${l.cost_code}` : ""}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center" }}>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: l.priced ? c.ink : c.hint, minWidth: 90 }}>{l.priced ? `${money(l.rate)} → ${money(l.amount)}` : l.linked ? "No rate" : "Edited in Lines tab"}</span>
                  {l.price_source && (
                    <span style={{ fontSize: 11.5, color: l.stale && !l.stale_accepted ? "var(--amberink)" : c.muted }}>
                      {PRICE_SOURCE_LABEL[l.price_source]}{l.price_source_ref ? ` · ${l.price_source_ref}` : ""} · {fmtDate(l.price_as_of)}
                      {l.stale && <b> · {l.stale_text}{l.stale_accepted ? ", accepted knowingly" : ""}</b>}
                      {!l.stale && l.stale_accepted && " · accepted knowingly"}
                    </span>
                  )}
                  {l.unit_cost != null && (
                    <span style={{ fontSize: 11.5, color: c.hint, display: "inline-flex", alignItems: "center", gap: 4 }}>cost {money(l.unit_cost)} + {l.markup_pct ?? 0}% <InfoTip label="Cost">{TENDER_TIPS.boqCost}</InfoTip></span>
                  )}
                  {canEdit && l.linked && <Button size="sm" variant="secondary" onClick={() => void openPicker(l)} style={{ minHeight: 44, marginLeft: "auto" }} data-guide="boq.price_line">{openLine === l.id ? "Close" : l.priced ? "Change price" : "Price this line"}</Button>}
                </div>
                {est && l.linked && (
                  <LineEstimates opportunityId={opportunityId} base={estimatesBase} line={{ id: l.id, item_no: l.item_no, description: l.description, qty: l.qty, uom: l.uom, priced: l.priced }} state={est}
                    canEdit={canEdit} markup={Number(markup) || 0} onChanged={estimatesChanged} onError={onError} onNotice={onNotice} />
                )}
                {openLine === l.id && (
                  <div data-guide="boq.picker" style={{ background: "var(--panel2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, color: c.ink }}>Price sources <InfoTip label="Price sources">{TENDER_TIPS.boqPriceSource}</InfoTip></div>
                    {cands === null && <div style={{ fontSize: 12.5, color: c.hint }}>Looking…</div>}
                    {cands?.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>No supplier, BOM, past-project or client price was found for this line. Enter a rate below.</div>}
                    {cands?.map((cd) => (
                      <button key={cd.source + cd.ref} type="button" onClick={() => void choose(l, cd)} disabled={busy} data-guide="boq.candidate"
                        style={{ textAlign: "left", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", minHeight: 44, cursor: "pointer", color: c.ink, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
                        <b style={{ fontSize: 12 }}>{PRICE_SOURCE_LABEL[cd.source]}</b>
                        <span style={{ fontSize: 12.5, flex: "1 1 160px", overflowWrap: "anywhere" }}>{cd.label}</span>
                        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{money(rateFor(cd, Number(markup) || 0))}{cd.kind === "cost" ? ` (cost ${money(cd.price)})` : ""}</span>
                        <span style={{ fontSize: 11.5, color: cd.stale ? "var(--amberink)" : c.hint }}>{fmtDate(cd.as_of)}{cd.stale ? ` · ${cd.stale_text}` : ""}</span>
                      </button>
                    ))}
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <Field label="Manual rate" guide="boq.manual">
                        <Input type="number" min={0} step="0.01" inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} style={{ width: 130 }} />
                      </Field>
                      <Button variant="secondary" disabled={busy || manual === ""} onClick={async () => { const j = await post({ line: l.id, source: "manual", rate: Number(manual) }); if (j) { setOpenLine(null); onNotice("Price set"); } }} style={{ minHeight: 44 }} data-guide="boq.manual_apply">Use this rate</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {active.length > PAGE && (
            <Button variant="quiet" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="boq.show_all">{showAll ? "Show fewer" : `Show all ${active.length} lines`}</Button>
          )}
          {flagged.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--amberink)", marginTop: 8 }} data-guide="boq.kept">
              {flagged.length} priced line{flagged.length === 1 ? " is" : "s are"} no longer in the latest file and kept: {flagged.slice(0, 5).map((f) => f.item_no ?? f.description.slice(0, 30)).join(", ")}
            </div>
          )}
        </Card>
      )}

      {data.source && view === "download" && (
        <Card title="Download">
          {data.totals.unpriced > 0 && (
            <div role="alert" data-guide="boq.unpriced_warning" style={{ background: "var(--amberbg)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12.5, color: "var(--amberink)", display: "flex", flexDirection: "column", gap: 2 }}>
              <b>{data.totals.unpriced} line{data.totals.unpriced === 1 ? " has" : "s have"} no rate and will be left blank in the file</b>
              {data.unpriced.slice(0, 10).map((u) => <div key={u.item} style={{ overflowWrap: "anywhere" }}>{u.item}: {u.reason}</div>)}
              {data.totals.unpriced > 10 && <div>…and {data.totals.unpriced - 10} more</div>}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <Button variant="primary" onClick={() => void download("priced")} style={{ minHeight: 44 }} data-guide="boq.download">Download priced BOQ</Button>
            <InfoTip label="Download">{TENDER_TIPS.boqDownload}</InfoTip>
            <Button variant="secondary" onClick={() => void download("answer")} style={{ minHeight: 44 }} data-guide="boq.answer_sheet">Export answer sheet</Button>
            <InfoTip label="Answer sheet">{TENDER_TIPS.boqAnswerSheet}</InfoTip>
          </div>
          {data.source.added_columns && (
            <div style={{ fontSize: 12, color: c.hint, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>Rate and amount columns are added to the client&apos;s file <InfoTip label="Added columns">{TENDER_TIPS.boqAddedColumns}</InfoTip></div>
          )}
        </Card>
      )}
    </div>
  );
}
