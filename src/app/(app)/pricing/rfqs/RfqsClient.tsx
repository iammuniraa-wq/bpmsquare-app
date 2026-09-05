"use client";

import { useCallback, useEffect, useState } from "react";
import { c, pillar } from "@/lib/theme";

type Rfq = {
  id: string; ref: string | null; status: "draft" | "sent" | "replied" | "cancelled";
  cost_model_code: string; path: string; quantity: number | null; uom: string | null;
  sent_to: string | null; sent_at: string | null; message: string | null;
  reply_value: number | null; reply_currency: string | null; reply_valid_from: string | null; reply_valid_to: string | null; reply_note: string | null; replied_at: string | null;
  created_at: string;
  products: { id: string; ref: string | null; name: string; uom: string | null } | null;
  suppliers: { id: string; ref: string | null; name: string; email: string | null } | null;
};

const input: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 12.5, color: c.ink, background: "var(--panel)", boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", color: c.muted };
const primary: React.CSSProperties = { ...btn, background: c.accent, color: "#fff", borderColor: "transparent" };

function StatusChip({ status }: { status: Rfq["status"] }) {
  const tone = status === "replied" ? pillar.green : status === "sent" ? pillar.blue : status === "cancelled" ? pillar.red : pillar.amber;
  const label = { draft: "Not sent", sent: "Waiting for reply", replied: "Replied", cancelled: "Cancelled" }[status];
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: tone.bg, color: tone.fg, whiteSpace: "nowrap" }}>{label}</span>;
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function RfqsClient() {
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [form, setForm] = useState({ value: "", currency: "", valid_from: "", valid_to: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pricing/rfqs");
    const json = await res.json().catch(() => ({}));
    setPending(Boolean(json.pending_migration));
    setRfqs(json.rfqs ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/pricing/rfqs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "That didn't work"); return false; }
      if (body.action === "reply") setNotice(`Recorded as a confirmed cost, valid ${json.valid_from} → ${json.valid_to}. Price the line again to use it.`);
      if (body.action === "resend") setNotice(json.sent?.ok ? `Sent to ${json.sent.to.join(", ")}${json.sent.redirected ? " (redirected)" : ""}.` : json.sent?.reason ?? "Not sent");
      await load();
      return true;
    } finally { setBusy(false); }
  }

  async function submitReply(id: string) {
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) { setError("Enter the supplier's unit price."); return; }
    const ok = await act(id, { action: "reply", value, currency: form.currency || null, valid_from: form.valid_from || null, valid_to: form.valid_to || null, note: form.note || null });
    if (ok) { setReplyFor(null); setForm({ value: "", currency: "", valid_from: "", valid_to: "", note: "" }); }
  }

  if (rfqs === null) return <div style={{ padding: 24, color: c.muted, fontSize: 13 }}>Loading…</div>;

  const shown = filter === "open" ? rfqs.filter((r) => r.status === "draft" || r.status === "sent") : rfqs;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button style={{ ...btn, ...(filter === "open" ? { background: "var(--bluebg)", color: "var(--blueink)" } : {}) }} onClick={() => setFilter("open")}>Open</button>
        <button style={{ ...btn, ...(filter === "all" ? { background: "var(--bluebg)", color: "var(--blueink)" } : {}) }} onClick={() => setFilter("all")}>All</button>
        <span style={{ fontSize: 12, color: c.hint }}>{shown.length} of {rfqs.length}</span>
        {pending && <span style={{ fontSize: 12, color: "var(--amberink)" }}>RFQs need migration 0113 on this database.</span>}
      </div>
      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12.5, color: "var(--tealink)", marginBottom: 10 }}>{notice}</div>}

      {shown.length === 0 && (
        <div style={{ padding: 24, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, textAlign: "center", fontSize: 13, color: c.muted }}>
          {filter === "open" ? "Nothing waiting on a supplier." : "No RFQs yet — the quote form raises one when the engine has no cost for a product."}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((r) => (
          <div key={r.id} style={{ border: `1px solid ${c.line}`, borderRadius: 10, background: c.panel, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <div>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: c.hint, marginRight: 8 }}>{r.ref ?? "—"}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>{r.products?.name ?? "Product"}</span>
                <span style={{ fontSize: 12, color: c.muted, marginLeft: 8 }}>{r.quantity ?? "—"} {r.uom ?? r.products?.uom ?? ""}</span>
              </div>
              <StatusChip status={r.status} />
            </div>
            <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4 }}>
              {r.suppliers ? `${r.suppliers.name}${r.suppliers.email ? ` · ${r.suppliers.email}` : " · no email"}` : "No supplier chosen"}
              {r.sent_at ? ` · sent ${fmtDate(r.sent_at)}${r.sent_to ? ` to ${r.sent_to}` : ""}` : ""}
              {" · "}<span style={{ fontFamily: "monospace" }}>{r.cost_model_code} · {r.path}</span>
            </div>
            {r.status === "replied" && (
              <div style={{ fontSize: 13, color: c.ink, marginTop: 6 }}>
                Reply: <b>{Number(r.reply_value).toLocaleString()}</b>{r.reply_currency ? ` ${r.reply_currency}` : ""} per unit, valid {r.reply_valid_from} → {r.reply_valid_to}{r.reply_note ? ` · ${r.reply_note}` : ""}
              </div>
            )}
            {(r.status === "sent" || r.status === "draft") && replyFor !== r.id && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button style={primary} disabled={busy} onClick={() => { setReplyFor(r.id); setError(null); }}>Enter reply</button>
                {r.suppliers?.email && <button style={btn} disabled={busy} onClick={() => act(r.id, { action: "resend" })}>{r.status === "draft" ? "Send" : "Resend"}</button>}
                <button style={btn} disabled={busy} onClick={() => act(r.id, { action: "cancel" })}>Cancel</button>
              </div>
            )}
            {replyFor === r.id && (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                <label style={{ fontSize: 11, color: c.hint }}>Unit price<input type="number" style={{ ...input, width: "100%" }} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
                <label style={{ fontSize: 11, color: c.hint }}>Currency<input style={{ ...input, width: "100%" }} placeholder="INR" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></label>
                <label style={{ fontSize: 11, color: c.hint }}>Valid from<input type="date" style={{ ...input, width: "100%" }} value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></label>
                <label style={{ fontSize: 11, color: c.hint }}>Valid to<input type="date" style={{ ...input, width: "100%" }} value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></label>
                <label style={{ fontSize: 11, color: c.hint, gridColumn: "1 / -1" }}>Note<input style={{ ...input, width: "100%" }} placeholder="Lead time, MOQ, anything the buyer should know" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6 }}>
                  <button style={primary} disabled={busy} onClick={() => submitReply(r.id)}>{busy ? "Saving…" : "Save as confirmed cost"}</button>
                  <button style={btn} disabled={busy} onClick={() => setReplyFor(null)}>Cancel</button>
                </div>
                <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: c.hint }}>Leave the dates blank for "from today, for 180 days".</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
