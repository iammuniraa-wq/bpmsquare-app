"use client";

import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { ESTIMATE_TIPS } from "@/lib/estimator/tips";

/**
 * Create quote, the one action of the page, and what it does in plain words.
 * An estimate that already has a quote shows the link instead and says why it
 * is locked. Save as draft is for a new estimate that is not ready to quote.
 */
export default function QuoteActions({
  quote, canQuote, quoteUnavailable, forTender, blocked, blockedShown = false, busy, isNew, error, onCreate, onSaveDraft,
}: {
  quote: { id: string; ref: string; status: string } | null;
  canQuote: boolean;
  quoteUnavailable: string | null;
  /** An estimate made for a tender is not quoted from here: the BOQ takes its cost. Nothing about quotes is shown (a new one can still be saved as a draft). */
  forTender?: boolean;
  /** Why Create quote cannot be pressed yet, in plain words. */
  blocked: string | null;
  /** The reason is already on the card above (the empty price), so it is not printed a second time here. */
  blockedShown?: boolean;
  busy: null | "draft" | "save" | "quote" | "recalc";
  isNew: boolean;
  error: string;
  onCreate: () => void;
  onSaveDraft: () => void;
}) {
  if (quote) {
    return (
      <Button href={ROUTES.standardQuote(quote.id)} variant="primary" style={{ width: "100%", justifyContent: "center" }}>Open quote {quote.ref}</Button>
    );
  }
  if (forTender) {
    if (!error && !isNew) return null;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {error && <div role="alert" className="est-warn">{error}</div>}
        {isNew && <Button variant="secondary" loading={busy === "draft"} disabled={busy !== null} onClick={onSaveDraft} style={{ width: "100%", justifyContent: "center" }}>Save as draft</Button>}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {error && <div role="alert" className="est-warn">{error}</div>}
      {canQuote ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Button variant="primary" loading={busy === "quote"} disabled={!!blocked || busy !== null} onClick={onCreate} style={{ flex: 1, justifyContent: "center" }}>Create quote</Button>
          <InfoTip label="Create quote">{ESTIMATE_TIPS.createQuote}</InfoTip>
        </div>
      ) : (
        quoteUnavailable && <div className="bpm-t-help">{quoteUnavailable}</div>
      )}
      {canQuote && blocked && !blockedShown && <div className="bpm-t-help" role="status">{blocked}</div>}
      {isNew && (
        <Button variant="secondary" loading={busy === "draft"} disabled={busy !== null} onClick={onSaveDraft} style={{ width: "100%", justifyContent: "center" }}>Save as draft</Button>
      )}
    </div>
  );
}
