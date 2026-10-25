"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { TENDER_TIPS } from "@/lib/tender/tips";

// Releasing a bid bond cannot be undone, so the button only asks; the release happens on the second, explicit Confirm. The question is
// inline (no browser dialog), stays on the screen until answered, and Cancel leaves the bond held.

export default function BondRelease({ loading, onConfirm, initialAsking = false }: {
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Lets a server render (and its test) show the question without a click. The page never passes it. */
  initialAsking?: boolean;
}) {
  const [asking, setAsking] = useState(initialAsking);
  if (!asking) {
    return (
      <>
        <Button variant="secondary" loading={loading} data-guide="tender.bond.release" style={{ minHeight: 44 }} onClick={() => setAsking(true)}>Release bond</Button>
        <InfoTip label="Release bond">{TENDER_TIPS.bondRelease}</InfoTip>
      </>
    );
  }
  return (
    <div role="alertdialog" aria-label="Release the bond" data-guide="tender.bond.confirm" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, background: "var(--amberbg)", borderRadius: 8, padding: "8px 12px" }}>
      <span style={{ fontSize: 13, color: "var(--amberink)", fontWeight: 600 }}>Release the bond? This cannot be undone.</span>
      <Button variant="primary" loading={loading} style={{ minHeight: 44 }} data-guide="tender.bond.confirm_yes" onClick={async () => { await onConfirm(); setAsking(false); }}>Confirm</Button>
      <Button variant="secondary" disabled={loading} style={{ minHeight: 44 }} data-guide="tender.bond.confirm_cancel" onClick={() => setAsking(false)}>Cancel</Button>
    </div>
  );
}
