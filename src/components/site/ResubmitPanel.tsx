"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Field from "@/components/ui/Field";
import { cardStyle } from "@/components/Shell";
import { Banner, Chips } from "./siteUi";

type Initial = { category_id: string | null; line_key: string | null; expense_date: string; amount: number; vendor_text: string | null; note: string | null };

/** The person who entered an expense that was returned corrects it and sends it again (PATCH: an allowlist of fields, status back to waiting). */
export default function ResubmitPanel({ id, reason, initial, categories, lines }: { id: string; reason: string | null; initial: Initial; categories: { id: string; name: string }[]; lines: { line_key: string; description: string }[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(initial.amount));
  const [date, setDate] = useState(initial.expense_date);
  const [vendor, setVendor] = useState(initial.vendor_text ?? "");
  const [category, setCategory] = useState<string | null>(initial.category_id);
  const [line, setLine] = useState(initial.line_key ?? "");
  const [note, setNote] = useState(initial.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/site-expenses/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, expense_date: date, vendor_text: vendor || null, category_id: category, line_key: line || null, note: note || null }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not send it again"); return; }
    router.refresh();
  }

  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }} className="bpm-tap" data-guide="site.expense.resubmit">
      <Banner tone="warn">Returned: {reason ?? "no reason given"}</Banner>
      <Field label="Amount"><input className="bpm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Date"><input className="bpm-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Vendor"><input className="bpm-input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
      <Field label="Category"><Chips label="Category" value={category} onChange={setCategory} options={categories.map((x) => ({ id: x.id, label: x.name }))} /></Field>
      <Field label="Cost line">
        <select className="bpm-input" value={line} onChange={(e) => setLine(e.target.value)}>
          <option value="">Not sure</option>
          {lines.map((l) => <option key={l.line_key} value={l.line_key}>{l.description}</option>)}
        </select>
      </Field>
      <Field label="Note"><input className="bpm-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <Banner tone="bad">{error}</Banner>}
      <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send it again"}</button>
    </section>
  );
}
