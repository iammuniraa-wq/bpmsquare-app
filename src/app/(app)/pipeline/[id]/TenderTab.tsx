"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import StatusPill from "@/components/ui/StatusPill";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SettingsSection from "@/components/settings/SettingsSection";
import ClosingChip from "@/components/tender/ClosingChip";
import { TENDER_DECISION_LABEL, TENDER_PORTALS, TENDER_PORTAL_LABEL, type TenderDecision } from "@/lib/tender/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { TenderView } from "@/lib/tender/views";

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
const fmtStamp = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** A timestamptz as the value of a datetime-local input, in the browser's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "" : `${currency ?? ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();

/**
 * The Tender tab of a tender deal: the tender details, the recorded bid / no-bid decision and the bid bond, each a section
 * that opens and closes and remembers its state. Saves go to /api/opportunities/[id]/tender (an explicit field list) and
 * /api/opportunities/[id]/tender/decision (reason required for a no-go; who and when are the server's, not this form's).
 */
export default function TenderTab({ opportunityId, tender, accounts, nowIso, timezone, finished, onError, onNotice }: {
  opportunityId: string;
  tender: TenderView;
  accounts: { id: string; name: string }[];
  nowIso: string;
  timezone: string;
  /** The tender is submitted or closed: the closing date is shown as a date, not a countdown. */
  finished: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    tender_no: tender.tender_no ?? "", issuer_name: tender.issuer_name ?? "", issuer_account_id: tender.issuer_account_id ?? "",
    portal: tender.portal ?? "", closing_at: "", addenda_count: tender.addenda_count,
    bid_bond_amount: tender.bid_bond_amount != null ? String(tender.bid_bond_amount) : "", bid_bond_currency: tender.bid_bond_currency ?? "",
    bid_bond_expiry: tender.bid_bond_expiry ?? "",
  });
  const [decision, setDecision] = useState<TenderDecision | null>(tender.decision);
  const [reason, setReason] = useState(tender.decision_reason ?? "");

  // The browser's own zone is only known after mount; reading it during render would make the server and client pages differ.
  useEffect(() => { setForm((f) => ({ ...f, closing_at: toLocalInput(tender.closing_at) })); }, [tender.closing_at]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save(keys: (keyof typeof form)[], okMessage: string) {
    startTransition(async () => {
      onError(""); onNotice("");
      const body: Record<string, unknown> = {};
      for (const k of keys) {
        const v = form[k];
        if (k === "closing_at") body[k] = v ? new Date(v as string).toISOString() : null;
        else if (k === "addenda_count") body[k] = v;
        else body[k] = v === "" ? null : v;
      }
      const res = await fetch(`/api/opportunities/${opportunityId}/tender`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not save"); return; }
      onNotice(okMessage);
      router.refresh();
    });
  }

  function saveDecision() {
    if (!decision) { onError("Choose Go or No-go"); return; }
    startTransition(async () => {
      onError(""); onNotice("");
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not save the decision"); return; }
      onNotice("Decision recorded");
      router.refresh();
    });
  }

  const bondSummary = tender.bid_bond_amount != null
    ? `${money(tender.bid_bond_amount, tender.bid_bond_currency)}${tender.bid_bond_expiry ? ` · valid to ${fmtDate(tender.bid_bond_expiry)}` : ""}`
    : "No bond recorded";
  const decisionSummary = tender.decision ? `${TENDER_DECISION_LABEL[tender.decision]}${tender.decided_by_name ? ` · ${tender.decided_by_name}` : ""}` : "Not decided yet";
  const decisionDirty = decision !== tender.decision || (reason.trim() || "") !== (tender.decision_reason ?? "");

  return (
    <div data-guide="tender.tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SettingsSection
        id="tender.details" title="Tender details" defaultOpen
        summary={[tender.tender_no, tender.issuer_name, tender.portal ? TENDER_PORTAL_LABEL[tender.portal] : null].filter(Boolean).join(" · ") || "Nothing filled in yet"}
      >
        <div className="fg2">
          <Field label="Tender number" info={TENDER_TIPS.tenderNo} guide="tender.field.tender_no"><Input value={form.tender_no} onChange={set("tender_no")} maxLength={60} /></Field>
          <Field label="Issuer" info={TENDER_TIPS.issuer} guide="tender.field.issuer"><Input value={form.issuer_name} onChange={set("issuer_name")} maxLength={200} /></Field>
          <Field label="Issuer account" guide="tender.field.issuer_account">
            <Select value={form.issuer_account_id} onChange={set("issuer_account_id")}>
              <option value="">— None —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Portal" info={TENDER_TIPS.portal} guide="tender.field.portal">
            <Select value={form.portal} onChange={set("portal")}>
              <option value="">— Not set —</option>
              {TENDER_PORTALS.map((p) => <option key={p} value={p}>{TENDER_PORTAL_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Closing date" info={TENDER_TIPS.closing} guide="tender.field.closing">
            <Input type="datetime-local" value={form.closing_at} onChange={set("closing_at")} />
          </Field>
          <Field label="Addenda" info={TENDER_TIPS.addenda} guide="tender.field.addenda">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button type="button" variant="secondary" iconOnly aria-label="One fewer addendum" disabled={form.addenda_count <= 0} onClick={() => setForm((f) => ({ ...f, addenda_count: Math.max(0, f.addenda_count - 1) }))} style={{ minWidth: 44, minHeight: 44 }}>−</Button>
              <span style={{ minWidth: 28, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} aria-live="polite">{form.addenda_count}</span>
              <Button type="button" variant="secondary" iconOnly aria-label="One more addendum" onClick={() => setForm((f) => ({ ...f, addenda_count: f.addenda_count + 1 }))} style={{ minWidth: 44, minHeight: 44 }}>+</Button>
            </div>
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button variant="primary" loading={pending} data-guide="tender.save" onClick={() => save(["tender_no", "issuer_name", "issuer_account_id", "portal", "closing_at", "addenda_count"], "Tender details saved")}>Save</Button>
          <ClosingChip closingAt={tender.closing_at} nowIso={nowIso} timezone={timezone} closed={finished} />
        </div>
      </SettingsSection>

      <SettingsSection id="tender.decision" title="Bid decision" info={TENDER_TIPS.decision} summary={decisionSummary} defaultOpen>
        <div data-guide="tender.decision" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tender.decision && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: c.muted }}>
              <StatusPill label={TENDER_DECISION_LABEL[tender.decision]} tone={tender.decision === "go" ? "green" : "red"} />
              <span>{[tender.decided_by_name, fmtStamp(tender.decided_at)].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          <div role="group" aria-label="Decision" style={{ display: "flex", gap: 8 }}>
            {(["go", "no_go"] as const).map((d) => (
              <Button
                key={d} type="button" variant={decision === d ? "primary" : "secondary"} aria-pressed={decision === d}
                data-guide={d === "go" ? "tender.decision.go" : "tender.decision.no_go"} style={{ flex: 1, minHeight: 44 }}
                onClick={() => setDecision(d)}
              >{TENDER_DECISION_LABEL[d]}</Button>
            ))}
          </div>
          <Field label={decision === "no_go" ? "Reason (required)" : "Reason"} guide="tender.decision.reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} style={{ minHeight: 70 }} />
          </Field>
          <div>
            <Button variant="primary" loading={pending} disabled={!decisionDirty || !decision} data-guide="tender.decision.save" onClick={saveDecision}>Record decision</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection id="tender.bond" title="Bid bond" info={TENDER_TIPS.bond} summary={bondSummary}>
        <div className="fg2">
          <Field label="Amount" guide="tender.field.bond_amount"><Input type="number" min="0" step="0.01" inputMode="decimal" value={form.bid_bond_amount} onChange={set("bid_bond_amount")} /></Field>
          <Field label="Currency" guide="tender.field.bond_currency"><Input value={form.bid_bond_currency} onChange={set("bid_bond_currency")} maxLength={3} placeholder="SAR" style={{ textTransform: "uppercase" }} /></Field>
          <Field label="Valid until" guide="tender.field.bond_expiry"><Input type="date" value={form.bid_bond_expiry} onChange={set("bid_bond_expiry")} /></Field>
        </div>
        <Button variant="primary" loading={pending} data-guide="tender.bond.save" onClick={() => save(["bid_bond_amount", "bid_bond_currency", "bid_bond_expiry"], "Bid bond saved")}>Save</Button>
      </SettingsSection>
    </div>
  );
}
