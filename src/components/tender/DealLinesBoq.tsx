"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import type { OpportunityLine } from "@/lib/types";
import { BoqCards, BoqTable, type BoqRow } from "./BoqRows";

// A tender whose lines were typed in by hand and never came from an uploaded client file (redesign, docs/design/gcc-tender-deals.md
// section 26). The Bill of quantities table shows the rows of an uploaded BOQ; without one this shows the deal's own lines in the SAME
// rows and opens the same side panel to edit one or add one. It saves through the deal's existing lines route (PUT, a full rewrite of up
// to 200 lines, sent with the version the screen loaded so a stale copy is refused). Once a client file is uploaded the table takes over.

export const HAND_LINE_LIMIT = 200;
const PAGE = 50;

type Draft = { id: string | null; sl_no: string; description: string; uom: string; qty: string; rate: string };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function toRows(lines: readonly OpportunityLine[]): BoqRow[] {
  return lines.filter((l) => !l.break_of).map((l, i) => ({
    id: l.id, line_id: l.id, row_no: i + 1, item_no: l.sl_no ?? null, cost_code: null, description: l.description, uom: l.uom ?? null, qty: num(l.qty),
    rate: num(l.rate), amount: num(l.qty) * num(l.rate) * (1 - num(l.discount_pct) / 100), priced: num(l.rate) > 0, linked: false, removed: false,
    price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null,
  }));
}

/** The body of the lines PUT: every line the deal has (so nothing is dropped), with the one change applied. */
export function linesPayload(lines: readonly OpportunityLine[], change: { replace?: Draft; remove?: string }) {
  const out = lines.filter((l) => l.id !== change.remove).map((l) => {
    const d = change.replace && change.replace.id === l.id ? change.replace : null;
    return {
      local_id: l.id, sl_no: d ? d.sl_no : l.sl_no, description: d ? d.description : l.description, uom: d ? d.uom : l.uom ?? "",
      qty: d ? d.qty : String(l.qty), rate: d ? d.rate : String(l.rate), discount_pct: String(l.discount_pct ?? 0),
      product_id: l.product_id ?? null, pricing_document_id: l.pricing_document_id ?? null, rfq_line_id: (l as { rfq_line_id?: string | null }).rfq_line_id ?? null,
      group_id: l.group_id ?? null, group_label: l.group_label ?? null, group_type: l.group_type ?? null,
      break_of: l.break_of ?? null, break_qty: l.break_qty ?? null, is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false,
    };
  });
  if (change.replace && change.replace.id === null) {
    const d = change.replace;
    out.push({
      local_id: "new", sl_no: d.sl_no || String(out.length + 1), description: d.description, uom: d.uom, qty: d.qty, rate: d.rate, discount_pct: "0",
      product_id: null, pricing_document_id: null, rfq_line_id: null, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null, is_selected: true, show_on_pdf: true,
    });
  }
  return out;
}

export default function DealLinesBoq({ opportunityId, lines, version, canEdit, cards, onError, onNotice, onChanged, initialDraft }: {
  opportunityId: string;
  lines: readonly OpportunityLine[];
  /** The fingerprint of the saved lines (linesVersion), sent back so the server can refuse a stale copy. */
  version: string;
  canEdit: boolean;
  /** Phone layout (cards) or table; the tab decides from the screen width. */
  cards: boolean;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onChanged: () => void;
  /** Lets a server render (and its test) show the open panel. The page never passes it. */
  initialDraft?: Draft;
}) {
  const { confirm } = useFeel();
  const [draft, setDraft] = useState<Draft | null>(initialDraft ?? null);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = toRows(lines);
  const tooMany = lines.length > HAND_LINE_LIMIT;
  const full = lines.length >= HAND_LINE_LIMIT;
  const editable = canEdit && !tooMany;
  useEffect(() => { setError(""); }, [draft?.id]);

  const open = (id: string) => {
    const l = lines.find((x) => x.id === id);
    if (l) setDraft({ id: l.id, sl_no: l.sl_no ?? "", description: l.description, uom: l.uom ?? "", qty: String(l.qty), rate: String(l.rate) });
  };
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  async function put(change: { replace?: Draft; remove?: string }, done: string) {
    setBusy(true); setError(""); onError("");
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/lines`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_version: version, lines: linesPayload(lines, change) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the lines"); onError(j.error ?? "Could not save the lines"); if (j.code === "lines_changed") onChanged(); return; }
      onNotice(done);
      setDraft(null);
      onChanged();
    } catch { setError("Network error. Try again."); } finally { setBusy(false); }
  }

  async function save() {
    if (!draft) return;
    if (!draft.description.trim()) { setError("A line needs a description"); return; }
    if (!(Number(draft.qty) >= 0) || draft.qty.trim() === "") { setError("Enter a quantity of 0 or more"); return; }
    if (draft.rate.trim() !== "" && !(Number(draft.rate) >= 0)) { setError("Enter a rate of 0 or more"); return; }
    await put({ replace: { ...draft, description: draft.description.trim(), rate: draft.rate.trim() === "" ? "0" : draft.rate } }, draft.id ? "Line saved" : "Line added");
  }

  async function remove() {
    if (!draft?.id) return;
    if (!(await confirm({ title: "Delete this line?", body: "It is removed from the tender's lines.", tone: "danger", confirmLabel: "Delete line" }))) return;
    await put({ remove: draft.id }, "Line deleted");
  }

  const page = rows.slice(0, shown);
  return (
    <div data-guide="boq.hand" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13.5, color: c.ink }}>Lines typed by hand · {rows.length}</b>
        {editable && <Button variant="secondary" disabled={full} onClick={() => setDraft({ id: null, sl_no: "", description: "", uom: "", qty: "1", rate: "" })} style={{ minHeight: 44 }} data-guide="boq.hand.add">Add line</Button>}
      </div>
      {tooMany && <div role="status" data-guide="boq.hand.too_many" style={{ fontSize: 12.5, color: "var(--amberink)" }}>This tender has {lines.length} lines, more than can be edited here ({HAND_LINE_LIMIT}). Upload the client&apos;s Excel to manage them as a Bill of quantities.</div>}
      {full && !tooMany && editable && <div role="status" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{HAND_LINE_LIMIT} lines is the most that can be kept here.</div>}
      {rows.length === 0 ? (
        <Card><div data-guide="boq.hand.empty" style={{ fontSize: 13, color: c.ink }}>{editable ? "No lines yet. Add one, or upload the client's Excel." : "This tender has no lines yet."}</div></Card>
      ) : cards ? (
        <BoqCards rows={page} links={[]} openId={draft?.id ?? null} onOpen={open} />
      ) : (
        <BoqTable rows={page} links={[]} openId={draft?.id ?? null} onOpen={open} />
      )}
      {rows.length > shown && <div><Button variant="quiet" onClick={() => setShown(shown + PAGE)} style={{ minHeight: 44 }} data-guide="boq.hand.show_more">Show {Math.min(PAGE, rows.length - shown)} more ({rows.length - shown} not shown)</Button></div>}

      {draft && (
        <SidePanel
          title={draft.id ? `Item ${draft.sl_no || "line"}` : "New line"} label={draft.id ? "Edit line" : "Add line"} onClose={() => setDraft(null)}
          footer={editable ? <Button variant="primary" loading={busy} onClick={() => void save()} style={{ minHeight: 44 }} data-guide="boq.hand.save">Save</Button> : undefined}
        >
          <div className="bpm-tap" data-guide="boq.hand.panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
            <Field label="Item number" guide="boq.hand.item"><Input value={draft.sl_no} onChange={set("sl_no")} disabled={!editable} maxLength={40} style={{ minHeight: 44 }} /></Field>
            <Field label="Description" guide="boq.hand.description"><Textarea value={draft.description} onChange={set("description")} disabled={!editable} maxLength={1000} style={{ minHeight: 64 }} /></Field>
            <div className="fg2">
              <Field label="Quantity" guide="boq.hand.qty"><Input type="number" min={0} step="any" inputMode="decimal" value={draft.qty} onChange={set("qty")} disabled={!editable} style={{ minHeight: 44 }} /></Field>
              <Field label="Unit" guide="boq.hand.uom"><Input value={draft.uom} onChange={set("uom")} disabled={!editable} maxLength={20} style={{ minHeight: 44 }} /></Field>
              <Field label="Rate" guide="boq.hand.rate"><Input type="number" min={0} step="0.01" inputMode="decimal" value={draft.rate} onChange={set("rate")} disabled={!editable} style={{ minHeight: 44 }} /></Field>
            </div>
            {editable && draft.id && <div><Button variant="quiet" onClick={() => void remove()} style={{ minHeight: 44, color: "var(--redink)" }} data-guide="boq.hand.delete">Delete line</Button></div>}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
