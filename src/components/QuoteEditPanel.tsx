"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Quote, QuoteLine } from "@/lib/types";
import { ROUTES } from "@/lib/constants";
import { Pencil } from "@/components/Icons";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

type Row = {
  description: string;
  qty: string;
  rate: string;
  discount_pct: string;
  group_id: string | null;
  group_label: string | null;
  group_type: string | null;
};

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 9px", fontSize: 12.5,
  border: `1px solid ${c.line}`, borderRadius: 6,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};

function lineAmount(r: Row): number {
  const qty  = Math.max(0, parseFloat(r.qty) || 0);
  const rate = Math.max(0, parseFloat(r.rate) || 0);
  const disc = Math.max(0, Math.min(100, parseFloat(r.discount_pct) || 0));
  return qty * rate * (1 - disc / 100);
}

export default function QuoteEditPanel({ quote, lines }: { quote: Quote; lines: QuoteLine[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const isDraft = quote.status === "draft";

  const [openEditor, setOpenEditor] = useState(false);
  const [validUntil, setValidUntil] = useState(quote.valid_until ?? "");
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [rows, setRows] = useState<Row[]>(
    lines.map((l) => ({
      description: l.description,
      qty: String(l.qty),
      rate: String(l.rate),
      discount_pct: String(l.discount_pct ?? 0),
      group_id: l.group_id ?? null,
      group_label: l.group_label ?? null,
      group_type: l.group_type ?? null,
    }))
  );

  const total = rows.reduce((s, r) => s + lineAmount(r), 0);

  const setRow = (i: number, k: keyof Row, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const addRow = () =>
    setRows((rs) => [...rs, { description: "", qty: "1", rate: "0", discount_pct: "0", group_id: null, group_label: null, group_type: null }]);

  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  function saveDraft() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/quotes/${quote.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valid_until: validUntil, notes, lines: rows }),
      });
      if (res.ok) { setOpenEditor(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  function createVersion() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/quotes/${quote.id}/revise`, { method: "POST" });
      if (res.ok) { const j = await res.json(); router.push(ROUTES.quotation(j.id)); }
      else { const j = await res.json(); setError(j.error ?? "Failed to create version"); }
    });
  }

  // ── Non-draft: create-new-version action ──────────────────────────────────────
  if (!isDraft) {
    return (
      <>
        <button
          type="button"
          onClick={createVersion}
          disabled={pending}
          title="This quote is locked. Create an editable copy as a new revision."
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.muted,
            border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 12px",
            fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Pencil size={13} color={c.muted} /> {pending ? "Creating…" : "Create new version"}
        </button>
        {error && <span style={{ fontSize: 12, color: "#dc2626", marginLeft: 8 }}>{error}</span>}
      </>
    );
  }

  // ── Draft: edit button + modal editor ─────────────────────────────────────────
  return (
    <>
      <button
        type="button"
        onClick={() => setOpenEditor(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, background: c.accent, color: "#fff",
          border: "none", borderRadius: 7, padding: "6px 14px",
          fontSize: 12.5, fontWeight: 600, cursor: "pointer",
        }}
      >
        <Pencil size={13} color="#fff" /> Edit quote
      </button>

      {openEditor && (
        <div
          onClick={() => !pending && setOpenEditor(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(10,20,35,.55)", zIndex: 200,
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "40px 16px", overflowY: "auto",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: c.panel, borderRadius: 14, width: "100%", maxWidth: 760,
              boxShadow: "0 20px 60px rgba(0,0,0,.35)", overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Edit quotation</div>
                <div style={{ fontSize: 12, color: c.hint, fontFamily: "monospace" }}>{quote.ref}</div>
              </div>
              <button onClick={() => setOpenEditor(false)} style={{ background: "none", border: "none", fontSize: 20, color: c.hint, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: "16px 20px", maxHeight: "60vh", overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Valid until</label>
                  <input style={inp} type="date" value={validUntil ? validUntil.slice(0, 10) : ""} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>

              <label style={lbl}>Line items</label>
              <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 58px 78px 54px 78px 28px", gap: 6, padding: "8px 10px", background: c.panel2, fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.3 }}>
                  <span>Description</span><span>Qty</span><span>Rate</span><span>Disc%</span><span style={{ textAlign: "right" }}>Amount</span><span />
                </div>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 58px 78px 54px 78px 28px", gap: 6, padding: "7px 10px", borderTop: `1px solid ${c.line}`, alignItems: "center" }}>
                    <input style={inp} value={r.description} onChange={(e) => setRow(i, "description", e.target.value)} placeholder="Work / part…" />
                    <input style={inp} type="number" min={0} value={r.qty} onChange={(e) => setRow(i, "qty", e.target.value)} />
                    <input style={inp} type="number" min={0} value={r.rate} onChange={(e) => setRow(i, "rate", e.target.value)} />
                    <input style={inp} type="number" min={0} max={100} value={r.discount_pct} onChange={(e) => setRow(i, "discount_pct", e.target.value)} />
                    <span style={{ fontSize: 12.5, textAlign: "right", fontWeight: 600, color: c.ink }}>{inr(lineAmount(r))}</span>
                    <button type="button" onClick={() => removeRow(i)} title="Remove" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addRow} style={{ background: "none", border: `1px dashed ${c.line}`, color: c.accent, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 16 }}>
                + Add line
              </button>

              <div style={{ marginBottom: 4 }}>
                <label style={lbl}>Notes &amp; terms</label>
                <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, validity, exclusions…" />
              </div>

              {error && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{ padding: "14px 20px", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 12.5, color: c.muted }}>
                Subtotal <strong style={{ color: c.ink, fontSize: 14, marginLeft: 6 }}>{inr(total)}</strong>
                <span style={{ marginLeft: 8, fontSize: 11, color: c.hint }}>+ GST on view</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setOpenEditor(false)} disabled={pending} style={{ padding: "8px 14px", borderRadius: 7, border: `1px solid ${c.line}`, background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button type="button" onClick={saveDraft} disabled={pending} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{pending ? "Saving…" : "Save changes"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
