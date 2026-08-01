"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";

type Line = { id: string; description: string; uom: string; qty: string; rate: string; discount_pct: string };

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 16 };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function newLine(): Line {
  return { id: Math.random().toString(36).slice(2), description: "", uom: "Nos", qty: "1", rate: "0", discount_pct: "0" };
}

function lineAmount(l: Line): number {
  const qty = parseFloat(l.qty) || 0;
  const rate = parseFloat(l.rate) || 0;
  const discount = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
  return qty * rate * (1 - discount / 100);
}

type EditQuote = {
  id: string;
  ref: string;
  account_id: string;
  contact_id: string | null;
  valid_until: string | null;
  notes: string | null;
  terms: string | null;
  lines: { sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; discount_pct: number }[];
};

export default function StandardQuoteForm({
  accounts, contacts, editQuote,
}: {
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  editQuote?: EditQuote;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [accountId, setAccountId] = useState(editQuote?.account_id ?? "");
  const [contactId, setContactId] = useState(editQuote?.contact_id ?? "");
  const [validUntil, setValidUntil] = useState(editQuote?.valid_until ?? "");
  const [notes, setNotes] = useState(editQuote?.notes ?? "");
  const [terms, setTerms] = useState(editQuote?.terms ?? "");
  const [lines, setLines] = useState<Line[]>(
    editQuote && editQuote.lines.length > 0
      ? editQuote.lines.map((l) => ({
          id: Math.random().toString(36).slice(2),
          description: l.description, uom: l.uom ?? "Nos",
          qty: String(l.qty), rate: String(l.rate), discount_pct: String(l.discount_pct),
        }))
      : [newLine()]
  );

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) { setError("Account is required"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item"); return; }
    setError("");
    const linePayload = cleanLines.map((l) => ({ description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct }));
    startTransition(async () => {
      const res = editQuote
        ? await fetch(`/api/standard-quotes/${editQuote.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contact_id: contactId || null,
              valid_until: validUntil || null,
              notes: notes || null,
              terms: terms || null,
              lines: linePayload,
            }),
          })
        : await fetch("/api/standard-quotes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_id: accountId,
              contact_id: contactId || null,
              valid_until: validUntil || null,
              notes: notes || null,
              terms: terms || null,
              lines: linePayload,
            }),
          });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.standardQuote(editQuote ? editQuote.id : json.id));
      else setError(json.error ?? `Failed to ${editQuote ? "save" : "create"} quote`);
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← {editQuote ? editQuote.ref : "All standard quotes"}
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>{editQuote ? `Edit ${editQuote.ref}` : "New Standard Quote"}</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>A plain quote for an account — description, quantity, rate</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Quote for</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Account *</label>
                  {editQuote ? (
                    <div style={{ ...inp, background: c.panel2, color: c.muted }}>
                      {accounts.find((a) => a.id === accountId)?.name ?? "—"}
                    </div>
                  ) : (
                    <select style={inp} value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); }} required>
                      <option value="">— Select account —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label style={lbl}>Contact</label>
                  <select style={inp} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">— None —</option>
                    {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Valid until</label>
                <input style={{ ...inp, maxWidth: 200 }} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: 0 }}>Line items</h3>
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, newLine()])}
                  style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                >
                  + Add line
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {lines.map((line, idx) => (
                  <div key={line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.hint }}>Line {idx + 1}</span>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={fw}>
                      <label style={lbl}>Description *</label>
                      <input style={inp} value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being quoted" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={lbl}>UOM</label>
                        <select style={inp} value={line.uom} onChange={(e) => updateLine(line.id, { uom: e.target.value })}>
                          {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Qty</label>
                        <input style={inp} type="number" min="0" step="any" value={line.qty} onChange={(e) => updateLine(line.id, { qty: e.target.value })} />
                      </div>
                      <div>
                        <label style={lbl}>Rate (₹)</label>
                        <input style={inp} type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(line.id, { rate: e.target.value })} />
                      </div>
                      <div>
                        <label style={lbl}>Discount %</label>
                        <input style={inp} type="number" min="0" max="100" step="0.1" value={line.discount_pct} onChange={(e) => updateLine(line.id, { discount_pct: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
                      = {inr(lineAmount(line))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Total: {inr(total)}</div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={fw}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Terms</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms…" />
              </div>
            </section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {error && (
              <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
                {error}
              </div>
            )}
            <button
              type="submit" disabled={pending}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              {pending ? "Saving…" : editQuote ? "Save Changes" : "Create Standard Quote"}
            </button>
            <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} style={{
              display: "block", textAlign: "center", padding: "10px 0",
              borderRadius: 8, border: `1px solid ${c.line}`,
              color: c.muted, fontSize: 13, textDecoration: "none",
            }}>
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
