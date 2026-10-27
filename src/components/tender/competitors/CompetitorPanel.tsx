"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { COMPETITOR_LIMITS, COMPETITOR_PRICES, COMPETITOR_PRICE_LABEL, type CompetitorView } from "@/lib/tender/competitors/rules";
import { COMPETITOR_TIPS } from "@/lib/tender/competitors/tips";

// Add or edit one competitor: a side panel on a desktop, a bottom sheet on a phone (the shared SidePanel). One required field (the name);
// the rest is what the team knows. The server checks everything again.

type Form = { name: string; website: string; country: string; expected_price: string; strengths: string; notes: string };
const blank: Form = { name: "", website: "", country: "", expected_price: "", strengths: "", notes: "" };
const fromCompetitor = (c: CompetitorView): Form => ({
  name: c.name, website: c.website ?? "", country: c.country ?? "", expected_price: c.expected_price ?? "", strengths: c.strengths ?? "", notes: c.notes ?? "",
});

export default function CompetitorPanel({ opportunityId, competitor, onClose, onSaved }: {
  opportunityId: string;
  /** Absent = a new competitor. */
  competitor?: CompetitorView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(competitor ? fromCompetitor(competitor) : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setError("");
    if (!form.name.trim()) { setError("Say who the competitor is"); return; }
    setBusy(true);
    try {
      const body = { name: form.name, website: form.website, country: form.country, expected_price: form.expected_price || null, strengths: form.strengths, notes: form.notes };
      const url = `/api/opportunities/${opportunityId}/competitors${competitor ? `/${competitor.id}` : ""}`;
      const res = await fetch(url, { method: competitor ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  const title = competitor ? "Edit competitor" : "Add competitor";
  return (
    <SidePanel
      title={title} label={title} onClose={onClose}
      footer={<Button variant="primary" loading={busy} data-guide="competitor.save" style={{ minHeight: 44 }} onClick={save}>Save</Button>}
    >
      <div className="bpm-tap" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="Company" required guide="competitor.field.name"><Input value={form.name} onChange={set("name")} maxLength={COMPETITOR_LIMITS.nameMax} autoFocus /></Field>
        <div className="fg2">
          <Field label="Website" guide="competitor.field.website"><Input value={form.website} onChange={set("website")} maxLength={COMPETITOR_LIMITS.websiteMax} inputMode="url" placeholder="rival.com" /></Field>
          <Field label="Country" guide="competitor.field.country"><Input value={form.country} onChange={set("country")} maxLength={COMPETITOR_LIMITS.countryMax} /></Field>
        </div>
        <Field label="Expected price" info={COMPETITOR_TIPS.expectedPrice} guide="competitor.field.price">
          <Select value={form.expected_price} onChange={set("expected_price")}>
            <option value="">Not set</option>
            {COMPETITOR_PRICES.map((p) => <option key={p} value={p}>{COMPETITOR_PRICE_LABEL[p]}</option>)}
          </Select>
        </Field>
        <Field label="Strengths" info={COMPETITOR_TIPS.strengths} guide="competitor.field.strengths"><Textarea value={form.strengths} onChange={set("strengths")} maxLength={COMPETITOR_LIMITS.strengthsMax} style={{ minHeight: 72 }} /></Field>
        <Field label="Note" guide="competitor.field.notes"><Textarea value={form.notes} onChange={set("notes")} maxLength={COMPETITOR_LIMITS.notesMax} style={{ minHeight: 72 }} /></Field>
      </div>
    </SidePanel>
  );
}
