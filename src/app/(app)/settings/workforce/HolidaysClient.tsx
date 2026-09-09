"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { parseImportFile, ImportParseError } from "@/lib/import/parse";
import type { ParsedSheet } from "@/lib/import/types";

type Holiday = { id: string; date: string; name: string; applies_to: "all" | "full_time" | "contractor" };
type UploadResult = { applied: number; skipped: { row: number; reason: string }[] };

const HOLIDAY_ALIASES: Record<"date" | "name" | "applies_to", string[]> = {
  date: ["date"],
  name: ["name", "holiday", "holiday name"],
  applies_to: ["applies to", "applies_to", "audience"],
};

function colIndex(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  return aliases.reduce((found, a) => (found !== -1 ? found : norm.indexOf(a)), -1);
}

function sheetToHolidayRows(sheet: ParsedSheet): { date: string; name: string; applies_to: string }[] {
  const dateIdx = colIndex(sheet.headers, HOLIDAY_ALIASES.date);
  const nameIdx = colIndex(sheet.headers, HOLIDAY_ALIASES.name);
  if (dateIdx === -1 || nameIdx === -1) {
    throw new Error('The file needs at least "Date" and "Name" columns.');
  }
  const appliesIdx = colIndex(sheet.headers, HOLIDAY_ALIASES.applies_to);
  return sheet.rows.map((cells) => ({
    date: cells[dateIdx] ?? "",
    name: cells[nameIdx] ?? "",
    applies_to: appliesIdx !== -1 ? cells[appliesIdx] ?? "" : "",
  }));
}

function downloadHolidayTemplate() {
  const csv = ["Date,Name,Applies To", "2027-01-26,Republic Day,all"].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "holidays-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle" };
const btn: React.CSSProperties = { padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function HolidaysClient() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date: "", name: "", applies_to: "all" as Holiday["applies_to"] });
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/wfm/holidays");
    if (res.ok) setHolidays(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addHoliday() {
    if (!form.date || !form.name.trim()) { setError("Date and name are required"); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wfm/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      setForm({ date: "", name: "", applies_to: "all" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function removeHoliday(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/wfm/holidays/${id}`, { method: "DELETE" });
      if (!res.ok) setError((await res.json()).error ?? "Delete failed");
      else await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setUploadBusy(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const sheet = await parseImportFile(file);
      const rows = sheetToHolidayRows(sheet);
      if (rows.length === 0) { setUploadError("That file has no data rows."); return; }
      const res = await fetch("/api/wfm/holidays/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();
      if (!res.ok) { setUploadError(json.error ?? "Upload failed"); return; }
      setUploadResult(json);
      await load();
    } catch (e) {
      setUploadError(e instanceof ImportParseError || e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const q = query.trim().toLowerCase();
  const visible = holidays.filter((h) => !q || h.name.toLowerCase().includes(q));

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>}

      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 3 }}>Upload a whole year at once</div>
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 10 }}>Columns: Date (YYYY-MM-DD), Name, Applies To (all / full_time / contractor — optional, defaults to everyone).</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={downloadHolidayTemplate}>Download template</button>
          <input
            ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            disabled={uploadBusy}
            style={{ fontSize: 12.5 }}
          />
          {uploadBusy && <span style={{ fontSize: 12, color: c.hint }}>Uploading…</span>}
        </div>
        {uploadError && <div style={{ fontSize: 12.5, color: statusInk.bad, marginTop: 8 }}>{uploadError}</div>}
        {uploadResult && (
          <div style={{ fontSize: 12.5, color: c.ink, marginTop: 8 }}>
            Added/updated {uploadResult.applied} holiday(s).
            {uploadResult.skipped.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: statusInk.warn, fontWeight: 600 }}>{uploadResult.skipped.length} row(s) skipped:</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: c.muted }}>
                  {uploadResult.skipped.slice(0, 20).map((s, i) => <li key={i}>Row {s.row}: {s.reason}</li>)}
                </ul>
                {uploadResult.skipped.length > 20 && <div style={{ color: c.hint, marginTop: 4 }}>…and {uploadResult.skipped.length - 20} more.</div>}
              </div>
            )}
          </div>
        )}
      </section>

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Holiday calendar</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 3, maxWidth: 620 }}>
              Days nobody is marked late or absent, and which show on every employee&apos;s leave
              calendar. Apply one to everybody, or to a single employment type.
            </div>
          </div>
          <input style={{ ...inp, width: 200 }} placeholder="Search holiday…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Date</th><th style={th}>Name</th><th style={th}>Applies to</th><th style={th}></th></tr></thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.id}>
                <td style={td}>{fmtDate(h.date)}</td>
                <td style={{ ...td, fontWeight: 600, color: c.ink }}>{h.name}</td>
                <td style={td}>{h.applies_to === "all" ? "Everyone" : h.applies_to === "full_time" ? "Full-time" : "Contractors"}</td>
                <td style={td}><button style={btn} disabled={busy} onClick={() => removeHoliday(h.id)}>Remove</button></td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={4}>No holidays configured.</td></tr>}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "0 1 150px" }}><label style={lbl}>Date</label><input style={inp} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div style={{ flex: "1 1 180px" }}><label style={lbl}>Name</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Independence Day" /></div>
          <div style={{ flex: "0 1 150px" }}>
            <label style={lbl}>Applies to</label>
            <select style={inp} value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value as Holiday["applies_to"] })}>
              <option value="all">Everyone</option><option value="full_time">Full-time only</option><option value="contractor">Contractors only</option>
            </select>
          </div>
          <button style={btnPrimary} disabled={busy} onClick={addHoliday}>Add holiday</button>
        </div>
      </section>
    </>
  );
}
