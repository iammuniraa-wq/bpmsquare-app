"use client";

import { useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { useTenant } from "@/lib/tenant-context";
import { rfqConfig, type RfqOriginType } from "@/lib/rfq/types";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import type { ComposerLine } from "./RfqComposer";
import type { RfqCreated } from "./RfqDialog";
import SupplierPicker from "./SupplierPicker";
import { useRfqSuppliers } from "./useRfqSuppliers";
import { submitRfq } from "./submitRfq";

// The simple RFQ form for ONE item, opened from a document line: the item is
// already picked (read-only), only the quantity is editable; the current
// supplier is pre-ticked and the business can add or swap any other supplier.
// Everything rarely needed sits behind "More options".

export default function RfqSingleForm({
  origin, originLabel, line, onCreated, onCancel,
}: {
  origin?: { type: RfqOriginType; id: string | null };
  originLabel?: string | null;
  line: ComposerLine;
  onCreated: (r: RfqCreated) => void;
  onCancel?: () => void;
}) {
  const tenant = useTenant();
  const replyDays = rfqConfig(tenant?.config?.rfq).default_response_days;
  const [qty, setQty] = useState(line.qty === null || line.qty === undefined ? "1" : String(line.qty));
  const [chosen, setChosen] = useState<string[]>([]);
  const [respondBy, setRespondBy] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [delivery, setDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [internal, setInternal] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "send">(null);
  const [error, setError] = useState<string | null>(null);

  const { suppliers, suggested, current, loading } = useRfqSuppliers(line.product_id ? [line.product_id] : []);

  // Start with the current supplier ticked -- once, never over the user's own choice.
  const seeded = useRef(false);
  useEffect(() => {
    if (loading || seeded.current) return;
    seeded.current = true;
    if (current?.length) setChosen((cs) => (cs.length ? cs : [current[0].supplier_id]));
  }, [loading, current]);

  const toggle = (id: string) => setChosen((cs) => (cs.includes(id) ? cs.filter((x) => x !== id) : [...cs, id]));

  async function save(send: boolean) {
    setBusy(send ? "send" : "draft");
    setError(null);
    try {
      const q = qty.trim() === "" ? null : Number(qty);
      if (q !== null && (!Number.isFinite(q) || q < 0)) throw new Error("Quantity must be a positive number.");
      if (send && !chosen.length) throw new Error("Tick at least one supplier to send to.");
      const r = await submitRfq({
        title: null,
        origin_type: origin?.type ?? "manual",
        origin_id: origin?.id ?? null,
        respond_by: respondBy || null,
        required_by: requiredBy || null,
        delivery_terms: delivery || null,
        notes_to_supplier: notes || null,
        notes_internal: internal || null,
        lines: [{ product_id: line.product_id ?? null, description: line.description, spec: line.spec ?? null, uom: line.uom ?? null, qty: q, source_line_id: line.source_line_id ?? null }],
        supplier_ids: chosen,
        send,
      });
      onCreated({ ...r, line_keys: [line.key ?? null] });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {originLabel && (
        <div style={{ fontSize: 12.5, color: c.muted }}>For <strong style={{ color: c.ink }}>{originLabel}</strong> — the customer and your prices are never shown to suppliers.</div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0,1fr) minmax(90px,140px)", alignItems: "end" }}>
        <div>
          <span className="bpm-t-label" style={{ display: "block", marginBottom: 5 }}>Item</span>
          <div style={{ padding: "8px 10px", border: `1px solid ${c.line}`, borderRadius: 7, background: c.panel2, fontSize: 13, color: c.ink, minHeight: 20 }}>
            <span style={{ fontWeight: 600 }}>{line.description}</span>
            {line.product_ref && <span style={{ color: c.hint, marginLeft: 8, fontSize: 12 }}>{line.product_ref}</span>}
          </div>
        </div>
        <Field label={`Quantity${line.uom ? ` (${line.uom})` : ""}`} style={{ marginBottom: 0 }}>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
      </div>

      <div>
        <span className="bpm-t-label" style={{ display: "block", marginBottom: 6 }}>Suppliers{chosen.length ? ` (${chosen.length} ticked)` : ""}</span>
        {loading || suppliers === null ? (
          <div style={{ fontSize: 12.5, color: c.hint }}>Looking up suppliers…</div>
        ) : (
          <SupplierPicker suppliers={suppliers} chosen={chosen} onToggle={toggle} suggested={suggested ?? []} current={current ?? []} highlightCurrent />
        )}
      </div>

      <Field label="Reply by" hint={`Leave empty to use your default: ${replyDays} day${replyDays === 1 ? "" : "s"} from today.`} style={{ marginBottom: 0 }}>
        <Input type="date" value={respondBy} onChange={(e) => setRespondBy(e.target.value)} />
      </Field>

      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: c.accent }}>More options</summary>
        <div style={{ display: "grid", gap: 12, marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="Needed by" style={{ marginBottom: 0 }}><Input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></Field>
          <Field label="Delivery terms" style={{ marginBottom: 0 }}><Input value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="e.g. DAP Doha" /></Field>
          <Field label="Notes to suppliers" style={{ marginBottom: 0 }}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Field label="Internal note" hint="Never sent to suppliers." style={{ marginBottom: 0 }}><Textarea rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} /></Field>
        </div>
      </details>

      {error && <div role="alert" style={{ fontSize: 13, color: "var(--redink)", background: "var(--redbg)", padding: "8px 12px", borderRadius: 7 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onCancel && <Button variant="quiet" onClick={onCancel} disabled={!!busy}>Cancel</Button>}
        <Button variant="secondary" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>Save as draft</Button>
        <Button variant="primary" onClick={() => save(true)} loading={busy === "send"} disabled={!!busy || !chosen.length}>
          {busy === "send" ? "Sending…" : "Send now"}
        </Button>
      </div>
      {!chosen.length && <div style={{ fontSize: 12, color: c.hint, textAlign: "right", marginTop: -8 }}>Tick a supplier to send now, or save as a draft and send later.</div>}
    </div>
  );
}
