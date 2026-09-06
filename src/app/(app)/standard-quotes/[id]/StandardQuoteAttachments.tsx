"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";

// Attachments on a Standard Quote (0119, docs/sales-engine-architecture.md
// §3.7): customer communication kept with the quote, and -- for an .xlsx
// or .csv -- "Create line items", which asks Replace / Append / Skip
// duplicates when the quote already has lines. Used on the detail page
// and as the form's third tab.

type Attachment = { id: string; file_name: string; mime_type: string | null; size_bytes: number; note: string | null; created_at: string };
type Preview = { file_name: string; rows: number; skipped_rows: number; existing_lines: number; duplicates: number; unresolved_products: string[]; sample: { description: string; qty: number; rate: number }[] };

const isSpreadsheet = (name: string) => /\.(xlsx|xlsm|csv|tsv|txt)$/i.test(name);
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const btn: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 6, border: `1px solid ${c.line}`, background: "transparent", color: c.ink, cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, border: "none", background: c.accent, color: "#fff" };
const link: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 };
const inp: React.CSSProperties = { padding: "7px 10px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, boxSizing: "border-box" };

export default function StandardQuoteAttachments({ quoteId, canCreateLines, onLinesCreated }: {
  quoteId: string;
  /** Draft quotes only -- the same rule as the edit page. */
  canCreateLines: boolean;
  /** Called after lines were created from a file; the host decides how to refresh. */
  onLinesCreated?: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ attachment: Attachment; data: Preview } | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/standard-quotes/${quoteId}/attachments`);
    setItems(res.ok ? await res.json() : []);
  }
  useEffect(() => { load(); }, [quoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("note", note);
      const res = await fetch(`/api/standard-quotes/${quoteId}/attachments`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Upload failed"); return; }
      setFile(null); setNote("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch { setError("Network error"); } finally { setBusy(false); }
  }

  async function remove(a: Attachment) {
    if (!window.confirm(`Remove ${a.file_name}?`)) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/standard-quotes/${quoteId}/attachments`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachment_id: a.id }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? "Could not remove"); return; }
      await load();
    } catch { setError("Network error"); } finally { setBusy(false); }
  }

  async function openPreview(a: Attachment) {
    setBusy(true); setError(""); setDone("");
    try {
      const res = await fetch(`/api/standard-quotes/${quoteId}/attachments/${a.id}/lines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not read the file"); return; }
      setPreview({ attachment: a, data: j as Preview });
    } catch { setError("Network error"); } finally { setBusy(false); }
  }

  async function apply(mode: "replace" | "append" | "skip_duplicates") {
    if (!preview) return;
    setApplying(true); setError("");
    try {
      const res = await fetch(`/api/standard-quotes/${quoteId}/attachments/${preview.attachment.id}/lines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the lines"); return; }
      setPreview(null);
      setDone(`${j.added} line${j.added === 1 ? "" : "s"} created from ${preview.attachment.file_name}${j.skipped_duplicates ? ` · ${j.skipped_duplicates} duplicate${j.skipped_duplicates === 1 ? "" : "s"} skipped` : ""} · the quote now has ${j.total_lines}.`);
      if (onLinesCreated) onLinesCreated(); else router.refresh();
    } catch { setError("Network error"); } finally { setApplying(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Attachments</div>
        <div style={{ fontSize: 11.5, color: c.hint }}>Customer emails, their RFQ, spreadsheets — kept with this quote, never public</div>
      </div>

      {items === null ? (
        <div style={{ fontSize: 12, color: c.hint }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: c.hint, padding: "8px 0" }}>Nothing attached yet.</div>
      ) : (
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
          {items.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
              <span style={{ fontSize: 14 }} aria-hidden>{isSpreadsheet(a.file_name) ? "▦" : /\.(pdf)$/i.test(a.file_name) ? "▤" : /\.(png|jpe?g|webp|heic)$/i.test(a.file_name) ? "▣" : "✉"}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <a href={`/api/standard-quotes/${quoteId}/attachments/${a.id}`} target="_blank" rel="noopener" style={{ color: c.accent, textDecoration: "none", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{a.file_name}</a>
                <div style={{ fontSize: 11, color: c.hint }}>{fmtSize(a.size_bytes)} · {fmtDate(a.created_at)}{a.note ? ` · ${a.note}` : ""}</div>
              </div>
              {isSpreadsheet(a.file_name) && canCreateLines && (
                <button type="button" disabled={busy} onClick={() => openPreview(a)} style={link}>Create line items</button>
              )}
              <button type="button" disabled={busy} onClick={() => remove(a)} title="Remove" style={{ ...link, color: "var(--red)" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div style={{ border: `1px solid ${c.accent}`, borderRadius: 8, padding: 12, marginBottom: 10, background: c.accentbg }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Create line items from {preview.data.file_name}</div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 4, lineHeight: 1.5 }}>
            {preview.data.rows} row{preview.data.rows === 1 ? "" : "s"} read{preview.data.skipped_rows ? ` (${preview.data.skipped_rows} blank skipped)` : ""}.
            {preview.data.existing_lines > 0 ? ` This quote already has ${preview.data.existing_lines} line${preview.data.existing_lines === 1 ? "" : "s"}` : " The quote has no lines yet"}
            {preview.data.duplicates > 0 ? `, and ${preview.data.duplicates} of the file's rows look like duplicates of them.` : "."}
            {preview.data.unresolved_products.length > 0 && (
              <div style={{ color: "var(--amberink)", marginTop: 2 }}>Not in the catalog (added as free text): {preview.data.unresolved_products.join(", ")}</div>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 6 }}>
            {preview.data.sample.map((s, i) => <div key={i}>· {s.description} — {s.qty} × {inr(s.rate)}</div>)}
            {preview.data.rows > preview.data.sample.length && <div>· … and {preview.data.rows - preview.data.sample.length} more</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {preview.data.existing_lines === 0 ? (
              <button type="button" disabled={applying} onClick={() => apply("append")} style={primary}>Add {preview.data.rows} line{preview.data.rows === 1 ? "" : "s"}</button>
            ) : (
              <>
                <button type="button" disabled={applying} onClick={() => apply("replace")} style={{ ...primary, background: "var(--red)" }}>Replace the {preview.data.existing_lines} existing</button>
                <button type="button" disabled={applying} onClick={() => apply("append")} style={primary}>Append all {preview.data.rows}</button>
                {preview.data.duplicates > 0 && (
                  <button type="button" disabled={applying} onClick={() => apply("skip_duplicates")} style={primary}>Append, skip {preview.data.duplicates} duplicate{preview.data.duplicates === 1 ? "" : "s"}</button>
                )}
              </>
            )}
            <button type="button" disabled={applying} onClick={() => setPreview(null)} style={btn}>Cancel</button>
          </div>
        </div>
      )}

      {done && <div style={{ fontSize: 12, color: "var(--tealink)", marginBottom: 8 }}>{done}</div>}
      {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.xlsm,.csv,.tsv,.txt,.doc,.docx,.eml,.msg,.ppt,.pptx" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. customer's RFQ of 3 Sep" style={{ ...inp, flex: 1, minWidth: 200 }} />
        <button type="button" disabled={!file || busy} onClick={upload} style={{ ...primary, opacity: !file || busy ? 0.5 : 1 }}>{busy ? "Working…" : "Upload"}</button>
      </div>
    </div>
  );
}
