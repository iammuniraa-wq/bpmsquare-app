"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SettingsSection from "@/components/settings/SettingsSection";
import { LOSS_REASONS, LOSS_REASON_LABEL } from "@/lib/constants";
import { OUTCOME_LIMITS, comparisonText, priceComparison, type OutcomeData } from "@/lib/tender/outcome";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { mergeOutcome } from "./refreshAfterSave";
import WhoWonPicker from "./competitors/WhoWonPicker";

// The Outcome section of the Overview, shown once the tender is Awarded, Lost or No-bid: the facts of how it ended, and our last
// submitted total beside the awarded / winning price with the difference. A lost tender requires the reason and who won.

const TITLE = { awarded: "Outcome: awarded", bid_lost: "Outcome: lost", no_bid: "Outcome: no-bid" } as const;
const fmtDay = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function OutcomeSection({ opportunityId, data: serverData, fmt, onError, onNotice, onChanged }: {
  opportunityId: string;
  data: OutcomeData;
  fmt: (n: number) => string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** Called after the outcome is saved and shown, so the page's other facts (header, stage chip) refresh. */
  onChanged?: () => void;
}) {
  // What is shown follows the save at once (the PATCH answers the saved facts); the page then refreshes behind it.
  const [data, setData] = useState(serverData);
  useEffect(() => { setData(serverData); }, [serverData]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    award_value: data.award_value != null ? String(data.award_value) : "", award_date: data.award_date ?? "",
    winning_bidder: data.winning_bidder ?? data.competitor ?? "", loss_reason: data.loss_reason ?? "", outcome_note: data.outcome_note ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const lost = data.stage === "bid_lost";
  const awarded = data.stage === "awarded";
  const priceLabel = lost ? "Winning price" : "Awarded value";

  async function save() {
    onError(""); onNotice("");
    if (lost && !form.winning_bidder.trim()) { onError("Say who won (the competitor)"); return; }
    if (lost && !form.loss_reason) { onError("Say why the tender was lost"); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { outcome_note: form.outcome_note };
      if (data.stage !== "no_bid") {
        body.award_value = form.award_value === "" ? null : form.award_value;
        body.award_date = form.award_date || null;
      }
      if (lost) { body.winning_bidder = form.winning_bidder; body.loss_reason = form.loss_reason; }
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/outcome`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not save"); return; }
      setData((cur) => mergeOutcome(cur, j, { lost, winning_bidder: form.winning_bidder, loss_reason: form.loss_reason }));
      onNotice("Outcome saved");
      onChanged?.();
    } finally { setBusy(false); }
  }

  const cmp = data.stage === "no_bid" ? null : priceComparison(data.our_total, data.award_value);
  const summary = data.pending ? "Needs a database update"
    : [lost ? data.winning_bidder ?? data.competitor : null, data.award_value != null ? `${priceLabel.toLowerCase()} ${fmt(data.award_value)}` : null].filter(Boolean).join(" · ") || "Nothing recorded yet";

  return (
    <SettingsSection id="tender.outcome" title={TITLE[data.stage]} info={TENDER_TIPS.outcome} summary={summary} defaultOpen>
      <div data-guide="tender.outcome" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.pending && <div role="alert" data-guide="tender.outcome.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Outcome facts need a database update (migration 0225). Ask your administrator to apply it.</div>}
        {data.stage !== "no_bid" && (
          <div data-guide="tender.outcome.compare" style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Our bid and the {lost ? "winning" : "awarded"} price <InfoTip label="Price comparison">{TENDER_TIPS.outcomeCompare}</InfoTip>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <div>
                <div style={{ fontSize: 12, color: c.hint }}>Our final bid{data.our_version ? ` (version ${data.our_version})` : ""}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{data.our_total != null ? fmt(data.our_total) : "No bid recorded"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: c.hint }}>{priceLabel}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{data.award_value != null ? fmt(data.award_value) : "Not recorded"}</div>
              </div>
              {cmp && (
                <div>
                  <div style={{ fontSize: 12, color: c.hint }}>Difference</div>
                  <div data-guide="tender.outcome.diff" style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: cmp.diff > 0 ? "var(--amberink)" : cmp.diff < 0 ? "var(--greenink)" : c.ink }}>
                    {cmp.diff > 0 ? "+" : cmp.diff < 0 ? "-" : ""}{fmt(Math.abs(cmp.diff))}
                  </div>
                </div>
              )}
            </div>
            {cmp && <div style={{ fontSize: 12.5, color: c.muted }}>{comparisonText(cmp, lost ? "winning price" : "awarded price")}</div>}
          </div>
        )}
        {data.canEdit && !data.pending && (
          <>
            <div className="fg2">
              {lost && (
                <Field label="Won by" required info={TENDER_TIPS.outcomeLostTo} guide="tender.outcome.won_by">
                  <WhoWonPicker opportunityId={opportunityId} value={form.winning_bidder} onChange={(name) => setForm((f) => ({ ...f, winning_bidder: name }))} guide="tender.outcome.won_by_pick" />
                </Field>
              )}
              {lost && (
                <Field label="Why we lost" required guide="tender.outcome.loss_reason">
                  <Select value={form.loss_reason} onChange={set("loss_reason")}>
                    <option value="">— Pick a reason —</option>
                    {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABEL[r]}</option>)}
                  </Select>
                </Field>
              )}
              {(lost || awarded) && (
                <Field label={priceLabel} guide="tender.outcome.value"><Input type="number" min="0" step="0.01" inputMode="decimal" value={form.award_value} onChange={set("award_value")} /></Field>
              )}
              {(lost || awarded) && <Field label="Award date" guide="tender.outcome.date"><Input type="date" value={form.award_date} onChange={set("award_date")} /></Field>}
            </div>
            <Field label="Note" guide="tender.outcome.note"><Textarea value={form.outcome_note} onChange={set("outcome_note")} maxLength={OUTCOME_LIMITS.noteMax} style={{ minHeight: 64 }} /></Field>
            <div><Button variant="primary" loading={busy} data-guide="tender.outcome.save" style={{ minHeight: 44 }} onClick={save}>Save outcome</Button></div>
          </>
        )}
        {(!data.canEdit || data.pending) && data.award_date && <div style={{ fontSize: 12.5, color: c.muted }}>Award date {fmtDay(data.award_date)}</div>}
      </div>
    </SettingsSection>
  );
}
