"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import { flaggedOf, gateBody, gateReady, GATE_MIN_REASON, needsAck, type AwardCheck } from "@/lib/suppliers/check/awardGate";
import { CHECK_TIPS } from "@/lib/suppliers/check/tips";
import { VERDICT_LABEL } from "@/lib/suppliers/check/types";

// The warning shown before an award goes to a supplier whose newest saved Supplier check is "Check first" or "Concerning" (and the neutral
// "Not verified yet" line for a supplier with no usable check). It asks for a reason and, for "Concerning", a tick; it never blocks. The
// award routes ask the same question again, so nothing here is trusted. The explanation of how the verdict works sits behind the "i".

export type AwardGate = {
  checks: AwardCheck[];
  askedIds: string[];
  loaded: boolean;
  reason: string;
  setReason: (v: string) => void;
  ack: boolean;
  setAck: (v: boolean) => void;
  ready: boolean;
  /** The two request fields the award routes read; empty while nothing is flagged. */
  body: { supplier_check_reason?: string; supplier_check_ack?: true };
};

/** The newest saved check of each supplier about to be awarded, and the person's answer to the warning. */
export function useAwardGate(ids: readonly (string | null | undefined)[]): AwardGate {
  const key = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].sort().join(",");
  const [state, setState] = useState<{ key: string; checks: AwardCheck[] } | null>(null);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`/api/rfqs/award-check?ids=${key}`)
      .then((r) => (r.ok ? r.json() : { checks: [] }))
      .then((j: { checks?: AwardCheck[] }) => { if (live) setState({ key, checks: j.checks ?? [] }); })
      .catch(() => { if (live) setState({ key, checks: [] }); });
    return () => { live = false; };
  }, [key]);
  const loaded = !key || state?.key === key;
  const checks = useMemo(() => (key && state?.key === key ? state.checks : []), [key, state]);
  const flagged = flaggedOf(checks).length > 0;
  return {
    checks, askedIds: key ? key.split(",") : [], loaded, reason, setReason, ack, setAck,
    ready: loaded && gateReady(checks, reason, ack),
    body: gateBody(reason, ack, flagged),
  };
}

const amberBox: React.CSSProperties = { border: "1px solid var(--amberink)", background: "var(--amberbg)", color: c.ink, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 };

export function AwardCheckPanel({ gate }: { gate: AwardGate }) {
  const flagged = flaggedOf(gate.checks);
  const unchecked = gate.askedIds.filter((id) => !gate.checks.some((k) => k.supplierId === id && k.verdict !== "unverified"));
  const single = flagged.length === 1;
  if (!gate.loaded) return null;
  if (!flagged.length) {
    return unchecked.length ? <div data-guide="award.check.unverified" style={{ fontSize: 12, color: c.hint }}>Not verified yet</div> : null;
  }
  return (
    <div role="alert" data-guide="award.check.warning" className="bpm-award-check" style={amberBox}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {flagged.map((f) => (
          <div key={f.supplierId} style={{ overflowWrap: "anywhere" }}>
            <b>{single ? "This supplier" : f.name}</b> is marked <b>{VERDICT_LABEL[f.verdict]}</b> in your Supplier check{f.findings.length ? `: ${f.findings.join(". ")}.` : "."}{" "}
            <a href={`${ROUTES.supplier(f.supplierId)}?tab=check`} target="_blank" rel="noopener noreferrer" data-guide="award.check.open" style={{ color: c.accent, whiteSpace: "nowrap" }}>Open the check</a>
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="award-check-reason" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Reason for awarding anyway <InfoTip label="the Supplier check warning">{CHECK_TIPS.awardWarning}</InfoTip>
        </label>
        <textarea
          id="award-check-reason" data-guide="award.check.reason" rows={2} maxLength={1000} value={gate.reason} onChange={(e) => gate.setReason(e.target.value)}
          aria-invalid={gate.reason.trim().length < GATE_MIN_REASON} style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.line}`, font: "inherit", resize: "vertical", background: "var(--card-bg, #fff)", color: c.ink }}
        />
      </div>
      {needsAck(flagged) && (
        <label data-guide="award.check.ack" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
          <input type="checkbox" checked={gate.ack} onChange={(e) => gate.setAck(e.target.checked)} style={{ width: 20, height: 20, flexShrink: 0 }} />
          <span>I have reviewed the findings</span>
        </label>
      )}
    </div>
  );
}

export default AwardCheckPanel;
