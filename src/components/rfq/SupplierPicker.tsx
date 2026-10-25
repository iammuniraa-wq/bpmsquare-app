"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { RFQ_TIPS } from "@/lib/rfq/tips";
import { currentDescription } from "@/lib/rfq/currentSupplierRank";
import type { CurrentForProduct, PickerSupplier, SuggestedSupplier } from "./useRfqSuppliers";
import { fmtDate } from "./rfqUi";

// The supplier part of both RFQ forms: the current supplier (when there is
// one), the tenant's own history as one-tap chips, then a searchable list of
// ALL active suppliers so the business can tick different or additional ones.
// Prices shown here are the tenant's own cost history -- internal, never sent.

export default function SupplierPicker({
  suppliers, chosen, onToggle, suggested, current, loading, highlightCurrent, typeFilter,
}: {
  suppliers: PickerSupplier[];
  chosen: string[];
  onToggle: (id: string) => void;
  suggested: SuggestedSupplier[];
  current: CurrentForProduct[];
  loading?: boolean;
  /** One item asked about: lead with its current supplier, or say there is none. */
  highlightCurrent?: boolean;
  /** Offer a vendors / subcontractors filter (the tender edition, where one RFQ may go to a supplier group). Off everywhere else. */
  typeFilter?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<"all" | "vendor" | "subcontractor">("all");
  const currentIds = useMemo(() => new Set(current.map((x) => x.supplier_id)), [current]);

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return suppliers
      .filter((s) => !t || `${s.name} ${s.city ?? ""} ${s.email ?? ""}`.toLowerCase().includes(t))
      .filter((s) => !typeFilter || kind === "all" || s.type === kind || s.type === "both")
      .sort((a, b) => Number(currentIds.has(b.id)) - Number(currentIds.has(a.id)))
      .slice(0, 60);
  }, [suppliers, filter, currentIds, typeFilter, kind]);

  const noEmail = chosen.filter((id) => !suppliers.find((s) => s.id === id)?.email);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {highlightCurrent && !loading && (
        current.length > 0 ? current.map((cur) => (
          <label key={cur.product_id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${chosen.includes(cur.supplier_id) ? c.accent : c.line}`, background: chosen.includes(cur.supplier_id) ? c.accentbg : c.panel, borderRadius: 8, cursor: "pointer" }}>
            <input type="checkbox" style={{ marginTop: 3 }} checked={chosen.includes(cur.supplier_id)} onChange={() => onToggle(cur.supplier_id)} aria-label={`Ask ${cur.name}, the current supplier`} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: c.ink }}>{cur.name}</span>
                <StatusPill label="Current supplier" tone="green" />
              </span>
              <span style={{ display: "block", fontSize: 12, color: c.muted, marginTop: 3 }}>
                {currentDescription(cur, fmtDate)}
                {cur.unit_price !== null && <span style={{ color: c.hint }}> (price is internal, not sent to suppliers)</span>}
              </span>
              {!cur.email && <span style={{ display: "block", fontSize: 12, color: "var(--amberink)", marginTop: 2 }}>No email on file for this supplier.</span>}
            </span>
          </label>
        )) : (
          <div style={{ fontSize: 13, color: c.muted, padding: "10px 12px", border: `1px dashed ${c.line}`, borderRadius: 8 }}>
            No supplier on record yet, pick who to ask.
          </div>
        )
      )}

      {suggested.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: c.hint }}>From your history:</span>
          {suggested.map((s) => {
            const on = chosen.includes(s.supplier_id);
            const title = s.awarded
              ? `Won ${s.awarded} time${s.awarded === 1 ? "" : "s"}${s.last_awarded_at ? `, last ${fmtDate(s.last_awarded_at)}` : ""}`
              : `Quoted ${s.quoted} time${s.quoted === 1 ? "" : "s"}`;
            return (
              <button key={s.supplier_id} type="button" onClick={() => onToggle(s.supplier_id)} title={title} aria-pressed={on}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${on ? c.accent : c.line}`, background: on ? c.accentbg : c.panel, color: on ? c.accent : c.ink }}>
                {on ? "✓ " : ""}{s.name}{s.awarded ? ` · won ${s.awarded}` : s.quoted ? ` · quoted ${s.quoted}` : ""}
              </button>
            );
          })}
        </div>
      )}

      {typeFilter && (
        <div data-guide="rfq.suppliers.type" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {([["all", "All"], ["vendor", "Vendors"], ["subcontractor", "Subcontractors"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${kind === k ? c.accent : c.line}`, background: kind === k ? c.accentbg : c.panel, color: kind === k ? c.accent : c.ink }}>{label}</button>
          ))}
          <InfoTip label="the supplier type">{RFQ_TIPS.type}</InfoTip>
        </div>
      )}
      <Input aria-label="Search suppliers" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={suppliers.length ? "Search all suppliers…" : "No suppliers yet — add them under Master data → Suppliers"} />
      <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
        {shown.map((s) => (
          <label key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${c.line}`, cursor: "pointer", fontSize: 13, color: c.ink }}>
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => onToggle(s.id)} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              {currentIds.has(s.id) && <span style={{ marginLeft: 8 }}><StatusPill label="Current supplier" tone="green" /></span>}
              <span style={{ color: c.hint, marginLeft: 6, fontSize: 12 }}>{[s.city, s.email ?? "no email"].filter(Boolean).join(" · ")}</span>
            </span>
          </label>
        ))}
        {!shown.length && <div style={{ padding: 12, fontSize: 12.5, color: c.hint }}>No suppliers match.</div>}
      </div>
      {noEmail.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--amberink)" }}>
          {noEmail.length} chosen supplier{noEmail.length === 1 ? " has" : "s have"} no email — they can be sent the reply link on WhatsApp from the RFQ.
        </div>
      )}
    </div>
  );
}
