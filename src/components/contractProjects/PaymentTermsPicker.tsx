"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { Select } from "@/components/ui/Input";
import { ROUTES } from "@/lib/constants";
import { percentTotal, termLines, type PaymentTermsChoice } from "@/lib/contractProjects/paymentTerms";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

type TermsState = { templates: { id: string; name: string; milestones: number }[]; chosen: PaymentTermsChoice | null };

/**
 * The payment-term template of a tender, chosen on its Bid tab. The choice prints on the cover of the bid documents and is kept with
 * the bid version that is submitted; the project's billing schedule later copies it. It reads and writes
 * /api/opportunities/[id]/tender/payment-terms, so a screen mounts it with the deal id alone:
 *
 *   <PaymentTermsPicker opportunityId={opp.id} canEdit={canEdit} />
 *
 * `initial` lets a server render (and its test) show it filled; the page never has to pass it.
 */
export default function PaymentTermsPicker({ opportunityId, canEdit, initial }: { opportunityId: string; canEdit: boolean; initial?: TermsState }) {
  const url = `/api/opportunities/${opportunityId}/tender/payment-terms`;
  const [state, setState] = useState<TermsState | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initial) return;
    let live = true;
    void fetch(url).then((r) => r.json()).then((j) => { if (live && j && Array.isArray(j.templates)) setState(j as TermsState); }).catch(() => undefined);
    return () => { live = false; };
  }, [url, initial]);

  async function choose(id: string) {
    setBusy(true); setError("");
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: id || null }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the payment terms"); return; }
      setState(j as TermsState);
    } finally { setBusy(false); }
  }

  if (!state) return <div data-guide="tender.payment_terms" style={{ fontSize: 13, color: c.hint, minHeight: 44, display: "flex", alignItems: "center" }}>Payment terms…</div>;
  const chosen = state.chosen;
  const total = chosen ? percentTotal(chosen.milestones) : 0;

  return (
    <div data-guide="tender.payment_terms" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: c.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Payment terms <InfoTip label="Payment terms">{PROJECT_TIPS.paymentTerms}</InfoTip></span>
        <Select aria-label="Payment terms" data-guide="tender.payment_terms.select" value={chosen?.template_id ?? ""} disabled={!canEdit || busy || state.templates.length === 0}
          style={{ minHeight: 44, width: "auto", minWidth: 200 }} onChange={(e) => { void choose(e.target.value); }}>
          <option value="">None chosen</option>
          {state.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          {chosen && !state.templates.some((t) => t.id === chosen.template_id) && <option value={chosen.template_id}>{chosen.name}</option>}
        </Select>
      </label>
      {state.templates.length === 0 && (
        <div role="status" style={{ fontSize: 13, color: c.hint }}>
          No payment-term templates yet. <Link href={ROUTES.settingsContractProjects} style={{ color: c.accent, display: "inline-flex", alignItems: "center", minHeight: 44 }}>Add one in Settings</Link>
        </div>
      )}
      {chosen && (
        <ul data-guide="tender.payment_terms.preview" style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: c.ink }}>
          {termLines(chosen.milestones).map((l, i) => <li key={i}>{l}</li>)}
          {total > 0 && total !== 100 && <li role="status" style={{ color: "var(--amberink)", listStyle: "none", marginLeft: -18 }}>The percents add up to {total}%.</li>}
        </ul>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
    </div>
  );
}
