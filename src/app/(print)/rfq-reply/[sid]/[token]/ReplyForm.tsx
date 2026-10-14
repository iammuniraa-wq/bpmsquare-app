"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupplierView } from "@/lib/rfq/compose";

type Row = {
  rfq_line_id: string;
  status: "quoted" | "no_quote" | "alternative";
  unit_price: string;
  lead_time_days: string;
  moq: string;
  offered_description: string;
  note: string;
};

type InitialResponse = {
  rfq_line_id: string; status: string; unit_price: number | null; lead_time_days: number | null;
  moq: number | null; offered_description: string | null; note: string | null;
};

type Header = {
  supplier_quote_ref: string | null; currency: string | null; incoterm: string | null; freight_amount: number | null;
  payment_terms: string | null; valid_until: string | null; note: string | null; status: string;
};

const ink = "#1c2733";
const muted = "#5f6b7a";
const line = "#e3e8ef";
const accent = "#1f4e8c";

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 10px", fontSize: 14, borderRadius: 8,
  border: `1px solid ${line}`, background: "#fff", color: ink, fontFamily: "inherit",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: muted, display: "block", marginBottom: 4 };
const card: React.CSSProperties = { background: "#fff", borderRadius: 14, boxShadow: "0 6px 28px rgba(16,24,40,.06)", border: `1px solid ${line}` };

const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

export default function ReplyForm({ sid, token, view, logoUrl, open, initialResponses, initialHeader, currencyHint }: {
  sid: string; token: string; view: SupplierView; logoUrl: string | null; open: boolean;
  initialResponses: InitialResponse[]; initialHeader: Header; currencyHint: string | null;
}) {
  const api = `/api/rfq-reply/${sid}/${token}`;
  const [rows, setRows] = useState<Row[]>(() => view.lines.map((l) => {
    const r = initialResponses.find((x) => x.rfq_line_id === l.id);
    return {
      rfq_line_id: l.id,
      status: (r?.status as Row["status"]) ?? "quoted",
      unit_price: r?.unit_price != null ? String(r.unit_price) : "",
      lead_time_days: r?.lead_time_days != null ? String(r.lead_time_days) : "",
      moq: r?.moq != null ? String(r.moq) : "",
      offered_description: r?.offered_description ?? "",
      note: r?.note ?? "",
    };
  }));
  const [header, setHeader] = useState({
    supplier_quote_ref: initialHeader.supplier_quote_ref ?? "",
    currency: initialHeader.currency ?? currencyHint ?? "",
    incoterm: initialHeader.incoterm ?? "",
    freight_amount: initialHeader.freight_amount != null ? String(initialHeader.freight_amount) : "",
    payment_terms: initialHeader.payment_terms ?? "",
    valid_until: initialHeader.valid_until ?? "",
    note: initialHeader.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(initialHeader.status === "replied" ? "We have your prices. You can update them below until the deadline." : initialHeader.status === "declined" ? "You told us you can't quote this request. You can still send prices below." : null);
  const [msg, setMsg] = useState("");
  const [msgState, setMsgState] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileState, setFileState] = useState<string | null>(null);

  useEffect(() => {
    fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "viewed" }) }).catch(() => {});
  }, [api]);

  const priced = useMemo(() => rows.filter((r) => r.status !== "no_quote" && r.unit_price.trim()).length, [rows]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(declined: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          declined,
          header: { ...header, freight_amount: header.freight_amount.trim() || null },
          rows: declined ? [] : rows.map((r) => ({ ...r, currency: header.currency })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't send your reply. Please try again.");
      setDone(declined ? "Thank you — we've noted that you can't quote this request." : `Thank you — ${j.saved} line${j.saved === 1 ? "" : "s"} received. You can update your prices here until the deadline.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (!msg.trim()) return;
    setMsgState("Sending…");
    const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", body: msg }) });
    const j = await res.json().catch(() => ({}));
    setMsgState(res.ok ? "Sent — the buyer will get back to you." : j.error ?? "Couldn't send.");
    if (res.ok) setMsg("");
  }

  async function upload() {
    if (!file) return;
    setFileState("Uploading…");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${api}/upload`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setFileState(res.ok ? (j.saved ? `Uploaded — ${j.saved} line(s) read from the sheet.` : `Uploaded ${j.filename}.`) : j.error ?? "Upload failed.");
    if (res.ok) setFile(null);
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ ...card, padding: "22px 24px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" style={{ height: 40, maxWidth: 140, objectFit: "contain" }} />
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: muted }}>Request for quotation · {view.ref}</div>
          <h1 style={{ fontSize: 20, margin: "4px 0 2px", color: ink, textWrap: "balance" }}>{view.title}</h1>
          <div style={{ fontSize: 13.5, color: muted }}>From {view.tenantName}{view.buyerName ? ` · ${view.buyerName}` : ""} to {view.supplierName}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: muted }}>
          {view.respondBy && <div>Reply by <strong style={{ color: ink }}>{view.respondBy}</strong></div>}
          {view.requiredBy && <div>Needed by {view.requiredBy}</div>}
          {view.deliveryTerms && <div>Delivery: {view.deliveryTerms}</div>}
        </div>
      </header>

      {done && <div role="status" style={{ ...card, padding: "14px 18px", background: "#eef8f1", borderColor: "#b9e2c6", color: "#1d5b33", fontSize: 14 }}>{done}</div>}
      {!open && <div role="status" style={{ ...card, padding: "14px 18px", background: "#fff8e6", borderColor: "#f3d48a", color: "#5a4300", fontSize: 14 }}>This request is closed. Your earlier reply is shown below.</div>}
      {view.notesToSupplier && <div style={{ ...card, padding: "14px 18px", fontSize: 14, whiteSpace: "pre-wrap", color: ink }}>{view.notesToSupplier}</div>}

      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Your prices</h2>
          <span style={{ fontSize: 13, color: muted }}>{priced} of {rows.length} line{rows.length === 1 ? "" : "s"} priced</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {view.lines.map((l, i) => {
            const r = rows[i];
            const off = r.status === "no_quote";
            return (
              <div key={l.id} style={{ padding: "16px 20px", borderBottom: `1px solid ${line}`, display: "grid", gap: 12, gridTemplateColumns: "minmax(0,1fr)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: muted, fontVariantNumeric: "tabular-nums" }}>{l.sl_no}.</span>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{l.description}</div>
                    {l.spec && <div style={{ fontSize: 13, color: muted, marginTop: 2, whiteSpace: "pre-wrap" }}>{l.spec}</div>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{l.qty ?? ""} {l.uom ?? ""}</div>
                </div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", opacity: off ? 0.45 : 1 }}>
                  <div>
                    <label style={label} htmlFor={`p-${l.id}`}>Unit price{header.currency ? ` (${header.currency})` : ""}</label>
                    <input id={`p-${l.id}`} style={input} inputMode="decimal" disabled={off || !open} value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} placeholder="0.00" />
                  </div>
                  <div>
                    <label style={label} htmlFor={`lt-${l.id}`}>Lead time (days)</label>
                    <input id={`lt-${l.id}`} style={input} inputMode="numeric" disabled={off || !open} value={r.lead_time_days} onChange={(e) => setRow(i, { lead_time_days: e.target.value })} />
                  </div>
                  <div>
                    <label style={label} htmlFor={`moq-${l.id}`}>Min. order qty</label>
                    <input id={`moq-${l.id}`} style={input} inputMode="decimal" disabled={off || !open} value={r.moq} onChange={(e) => setRow(i, { moq: e.target.value })} />
                  </div>
                </div>
                {r.status === "alternative" && (
                  <div>
                    <label style={label} htmlFor={`alt-${l.id}`}>What you're offering instead</label>
                    <input id={`alt-${l.id}`} style={input} disabled={!open} value={r.offered_description} onChange={(e) => setRow(i, { offered_description: e.target.value })} placeholder="Make, model, specification" />
                  </div>
                )}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: muted }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: open ? "pointer" : "default" }}>
                    <input type="checkbox" disabled={!open} checked={r.status === "alternative"} onChange={(e) => setRow(i, { status: e.target.checked ? "alternative" : "quoted" })} />
                    Offering an alternative
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: open ? "pointer" : "default" }}>
                    <input type="checkbox" disabled={!open} checked={off} onChange={(e) => setRow(i, { status: e.target.checked ? "no_quote" : "quoted", unit_price: e.target.checked ? "" : r.unit_price })} />
                    Can&apos;t quote this item
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ ...card, padding: "18px 20px", display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div>
          <label style={label} htmlFor="cur">Currency</label>
          <input id="cur" style={input} disabled={!open} maxLength={3} value={header.currency} onChange={(e) => setHeader({ ...header, currency: e.target.value.toUpperCase() })} placeholder="USD" />
        </div>
        <div>
          <label style={label} htmlFor="inc">Delivery terms (Incoterm)</label>
          <select id="inc" style={input} disabled={!open} value={header.incoterm} onChange={(e) => setHeader({ ...header, incoterm: e.target.value })}>
            <option value="">—</option>
            {INCOTERMS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="frt">Freight (total, if extra)</label>
          <input id="frt" style={input} inputMode="decimal" disabled={!open} value={header.freight_amount} onChange={(e) => setHeader({ ...header, freight_amount: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor="val">Prices valid until</label>
          <input id="val" type="date" style={input} disabled={!open} value={header.valid_until} onChange={(e) => setHeader({ ...header, valid_until: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor="pay">Payment terms</label>
          <input id="pay" style={input} disabled={!open} value={header.payment_terms} onChange={(e) => setHeader({ ...header, payment_terms: e.target.value })} placeholder="e.g. 30 days" />
        </div>
        <div>
          <label style={label} htmlFor="qref">Your quotation number</label>
          <input id="qref" style={input} disabled={!open} value={header.supplier_quote_ref} onChange={(e) => setHeader({ ...header, supplier_quote_ref: e.target.value })} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label} htmlFor="note">Notes for the buyer</label>
          <textarea id="note" rows={3} style={{ ...input, resize: "vertical" }} disabled={!open} value={header.note} onChange={(e) => setHeader({ ...header, note: e.target.value })} />
        </div>
      </section>

      {error && <div role="alert" style={{ ...card, padding: "12px 16px", background: "#fdecec", borderColor: "#f3b7b7", color: "#8a1f1f", fontSize: 14 }}>{error}</div>}

      {open && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" disabled={busy} onClick={() => submit(true)} style={{ padding: "11px 16px", borderRadius: 9, border: `1px solid ${line}`, background: "#fff", color: muted, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            We can&apos;t quote
          </button>
          <button type="button" disabled={busy || priced === 0} onClick={() => submit(false)} style={{ padding: "11px 22px", borderRadius: 9, border: "none", background: priced === 0 ? "#9fb3cc" : accent, color: "#fff", fontWeight: 700, fontSize: 14, cursor: priced === 0 ? "not-allowed" : "pointer" }}>
            {busy ? "Sending…" : "Send prices"}
          </button>
        </div>
      )}

      {open && (
        <section style={{ ...card, padding: "18px 20px", display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div>
            <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Attach your quotation</h3>
            <p style={{ fontSize: 13, color: muted, margin: "0 0 10px" }}>PDF, Excel or a photo — or the reply sheet from our email, filled in.</p>
            <input type="file" accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, maxWidth: "100%" }} />
            <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" disabled={!file} onClick={upload} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${accent}`, background: "#fff", color: accent, fontWeight: 600, fontSize: 13, cursor: file ? "pointer" : "not-allowed" }}>Upload</button>
              {fileState && <span style={{ fontSize: 13, color: muted }}>{fileState}</span>}
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Ask a question</h3>
            <textarea rows={3} style={{ ...input, resize: "vertical" }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Anything unclear about this request?" />
            <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" disabled={!msg.trim()} onClick={sendMessage} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${accent}`, background: "#fff", color: accent, fontWeight: 600, fontSize: 13, cursor: msg.trim() ? "pointer" : "not-allowed" }}>Send to buyer</button>
              {msgState && <span style={{ fontSize: 13, color: muted }}>{msgState}</span>}
            </div>
          </div>
        </section>
      )}

      {view.terms && <p style={{ fontSize: 12, color: muted, whiteSpace: "pre-wrap", margin: 0 }}>{view.terms}</p>}
      <p style={{ fontSize: 12, color: "#8a96a5", margin: 0, textAlign: "center" }}>Sent via BPMSquare on behalf of {view.tenantName}. Only you can see your prices on this page.</p>
    </div>
  );
}
