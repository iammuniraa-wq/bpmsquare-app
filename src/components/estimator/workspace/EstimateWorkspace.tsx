"use client";

import { useCallback, useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Select } from "@/components/ui/Input";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import { alternativesInput } from "@/lib/estimator/quoteLines";
import { shiftOptions } from "@/lib/estimator/preview";
import { marksForRef } from "@/lib/estimator/pieceInfo";
import { toParams } from "@/components/estimator/InputsForm";
import AccountPicker from "@/components/estimator/AccountPicker";
import type { AccountOption, ContactOption } from "@/components/estimator/AccountPicker";
import AboutCard from "./AboutCard";
import AccountPrompt from "./AccountPrompt";
import CustomerDetails from "./CustomerDetails";
import CustomerPreview from "./CustomerPreview";
import EmailIntake from "./EmailIntake";
import PriceCard from "./PriceCard";
import QuoteActions from "./QuoteActions";
import SenderCard from "./SenderCard";
import VillaCard from "./VillaCard";
import { EstimateFocusContext } from "./focus";
import { isDirty, shownFromPreview } from "./shown";
import { useEstimateActions } from "./useEstimateActions";
import { useEstimateDraft } from "./useEstimateDraft";
import type { DraftInit } from "./useEstimateDraft";
import { useLivePreview } from "./useLivePreview";
import type { ShownData, WorkspaceTemplate } from "./types";
import type { PriceView } from "@/lib/estimator/preview";
import type { ScheduleQty } from "@/lib/estimator/compute";

/** What a saved estimate brings: its stored figures, which win until the person edits. */
export type SavedEstimate = {
  id: string;
  locked: boolean;
  quote: { id: string; ref: string; status: string } | null;
  accountId: string;
  contactId: string;
  storedParams: Record<string, number | string | boolean>;
  storedMargin: number;
  templateOutdated: boolean;
  view: PriceView;
  shown: ShownData;
  unitCosts: Record<string, number>;
  schedule: ScheduleQty[];
};

export type WorkspaceProps = {
  templates: WorkspaceTemplate[];
  init: DraftInit;
  vatPct: number;
  accounts: AccountOption[];
  contacts: ContactOption[];
  canEdit: boolean;
  canQuote: boolean;
  quoteUnavailable: string | null;
  saved?: SavedEstimate;
  /** A bill-of-materials code to light up on arrival (old ?line= links). */
  initialHighlight?: string | null;
  /** The internal sections under the page, given the figures being shown. */
  renderInternal?: (shown: ShownData, template: WorkspaceTemplate | null) => React.ReactNode;
};

/**
 * The one working page for a new and a saved estimate: the customer's email, the
 * plain inputs, the exact model and the price side by side, and one action. It
 * recomputes as the person types (pure code in the browser, or the debounced
 * preview route for catalogue-priced templates) and saves nothing until a button
 * is pressed. A saved estimate shows its stored figures until it is edited.
 */
export default function EstimateWorkspace(p: WorkspaceProps) {
  const { saved } = p;
  const cur = useCurrency();
  const money = useMemo(() => moneyFormatter(cur, { maximumFractionDigits: 0 }), [cur]);
  const draft = useEstimateDraft(p.templates, p.init);
  const t = draft.template;
  const [accounts, setAccounts] = useState(p.accounts);
  const [contacts, setContacts] = useState(p.contacts);
  const [customerOpen, setCustomerOpen] = useState(true);
  const customerSummary = [accounts.find((a) => a.id === draft.accountId)?.name, contacts.find((c) => c.id === draft.contactId)?.name].filter(Boolean).join(" · ");
  const [highlightCode, setHighlightCode] = useState<string | null>(p.initialHighlight ?? null);
  const locked = !!saved?.locked;
  const editable = p.canEdit && !locked;

  const params = useMemo(() => (t ? toParams(t.inputs, draft.values) : {}), [t, draft.values]);
  const dirty = saved ? isDirty(saved.storedParams, params, saved.storedMargin, draft.margin) : true;
  const live = useLivePreview({
    template: t, values: draft.values, margin: draft.margin, vatPct: p.vatPct,
    fixedUnitCosts: saved?.unitCosts, schedule: saved?.schedule,
  });
  const act = useEstimateActions({ draft, savedId: saved?.id, savedAccountId: saved?.accountId, savedContactId: saved?.contactId, dirty });

  const showStored = !!saved && !dirty;
  const preview = live.preview;
  // A new estimate opens blank: no villa and no price until the person starts.
  const blank = !saved && !draft.started;
  const view = showStored ? saved.view : blank ? null : preview?.view ?? null;
  const shown = useMemo(() => (showStored ? saved.shown : shownFromPreview(blank ? null : preview)), [showStored, saved, preview, blank]);
  const options = showStored && preview ? shiftOptions(preview.options, saved.view.total - preview.view.total) : blank ? null : preview?.options ?? null;
  const altKey = t ? alternativesInput(t.inputs)?.key : undefined;

  const marks = useMemo(() => {
    const line = highlightCode ? shown.lines.find((l) => l.code === highlightCode) : null;
    return line && shown.model ? marksForRef(line.element_ref, shown.model.pieces) : undefined;
  }, [highlightCode, shown]);
  const show = useCallback((code: string) => {
    setHighlightCode(code);
    document.getElementById("villa")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, []);

  const blocked = !view ? "Fill in the details to see a price."
    : preview && !preview.complete && !showStored
      ? (live.status === "pricing" ? "Waiting for the catalogue prices."
        : live.unresolved.length > 0 ? `No product in your catalogue matches the item number for: ${live.unresolved.join(", ")}.`
        : "Some items have no cost in the catalogue yet, so this cannot be quoted.")
      : view.problems[0] ?? null;
  const issue = live.issues[0]?.message ?? act.issues[0]?.message;

  return (
    <EstimateFocusContext.Provider value={{ highlightCode, show }}>
      <div className="est-stack">
        {!saved && (
          <Card padding={16}>
            <button type="button" aria-expanded={customerOpen} aria-controls="est-customer-body" onClick={() => setCustomerOpen((o) => !o)}
              style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box" }}>
              <span className="bpm-t-label">Customer</span>
              <span className="bpm-t-help" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {customerSummary || "Not chosen yet"}
              </span>
              <span aria-hidden style={{ transition: "transform .15s", transform: customerOpen ? "rotate(180deg)" : "none" }}>▾</span>
            </button>
            {customerOpen && (
              <div id="est-customer-body" style={{ marginTop: 10 }}>
                <p className="bpm-t-help" style={{ margin: "0 0 10px" }}>
                  Start here: who is this quote for? Choose an account and contact, or read them from the customer&apos;s email below.
                </p>
                <AccountPicker accounts={accounts} contacts={contacts} accountId={draft.accountId} contactId={draft.contactId}
                  onAccount={draft.setAccountId} onContact={draft.setContactId} disabled={!editable || act.busy !== null} />
                {editable && draft.sender && !draft.accountId && (
                  <SenderCard sender={draft.sender} accounts={accounts} contacts={contacts} disabled={act.busy !== null}
                    onUse={(a, c) => { draft.setAccountId(a); draft.setContactId(c); }}
                    onAccountCreated={(a) => setAccounts((l) => [...l, a])}
                    onContactCreated={(c) => setContacts((l) => [...l, c])} />
                )}
              </div>
            )}
          </Card>
        )}
        {!saved && p.templates.length > 1 && (
          <Card padding={16}>
            <Field label="Template" hint={t?.description ?? undefined} style={{ marginBottom: 0 }}>
              <Select value={draft.templateId} onChange={(e) => draft.pickTemplate(e.target.value)} disabled={act.busy !== null}>
                {p.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
          </Card>
        )}
        {editable && t && <EmailIntake key={t.id} templateId={t.id} inputs={t.inputs} onApply={draft.applyProposal} />}
        {locked && <div className="est-note" role="status">This estimate has a quote, so it is locked. Everything below is as it was quoted.</div>}
        {!t && <Card padding={16}><div className="bpm-t-help">This estimate&apos;s template was deleted, so its inputs can&apos;t be shown or recalculated. Its lines and totals are kept as they were.</div></Card>}

        {blank && editable && (
          <div className="est-note" role="status">Paste the customer&apos;s email above, or fill in any detail, and the villa and the price appear here.</div>
        )}

        <div className="est-grid">
          {t && (
            <div id="about" style={{ scrollMarginTop: 80, minWidth: 0 }}>
            <AboutCard draft={draft} issues={[...live.issues, ...act.issues]} disabled={!editable || act.busy !== null} showCustomer={!saved}
              extra={!saved ? <CustomerDetails draft={draft} disabled={act.busy !== null} /> : undefined}>
              {saved && saved.templateOutdated && editable && !dirty && (
                <div className="est-warn" style={{ marginTop: 12 }}>
                  The template has changed since this estimate was calculated.{" "}
                  <Button size="sm" variant="secondary" loading={act.busy === "recalc"} onClick={act.recalculate}>Recalculate with the current template</Button>
                </div>
              )}
              {saved && editable && dirty && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <Button variant="primary" size="sm" loading={act.busy === "save"} disabled={act.busy !== null || !!live.issues.length} onClick={act.saveChanges}>Save changes</Button>
                  <Button variant="secondary" size="sm" disabled={act.busy !== null} onClick={draft.reset}>Discard changes</Button>
                </div>
              )}
            </AboutCard>
            </div>
          )}
          <div className="est-stack" style={{ gridColumn: t ? undefined : "1 / -1" }}>
            {t?.geometry && shown.model && (
              <VillaCard model={shown.model} lines={shown.lines} rates={t.rates} money={money} highlightMarks={marks}
                note={highlightCode && marks && marks.length > 0 ? `Lighting up the ${marks.length} pieces of the line "${highlightCode}".` : undefined}
                onUsePattern={editable ? (n) => { const o = t.inputs.find((i) => i.key === "pattern")?.options?.find((x) => x.value === n); if (o) draft.setValue("pattern", o.key); } : undefined} />
            )}
            <div id="price-card" style={{ scrollMarginTop: 80, minWidth: 0 }}>
            <PriceCard view={view} options={options} money={money}
              onPickOption={editable && altKey ? (k) => draft.setValue(altKey, k) : undefined}
              state={{ status: showStored ? "ready" : live.status, catalogue: live.catalogue, unsaved: !!saved && dirty, issue, notes: showStored ? [] : live.notes }}>
              {act.needAccount && !saved?.quote && (
                <div style={{ marginBottom: 12 }}>
                  <AccountPrompt accounts={accounts} contacts={contacts} accountId={draft.accountId} contactId={draft.contactId} customer={draft.customer}
                    onAccount={draft.setAccountId} onContact={draft.setContactId} onCreated={(a) => setAccounts((l) => [...l, a])}
                    onContinue={(id) => { draft.setAccountId(id); void act.createQuote(id); }} onCancel={() => act.setNeedAccount(false)} />
                </div>
              )}
              <QuoteActions quote={saved?.quote ?? null} canQuote={p.canQuote && p.canEdit} quoteUnavailable={p.quoteUnavailable} blocked={blocked}
                busy={act.busy} isNew={!saved} error={act.error} onCreate={() => void act.createQuote()} onSaveDraft={() => void act.saveDraft()} />
            </PriceCard>
            </div>
          </div>
        </div>

        {saved?.quote && view && view.sections.length > 0 && (
          <CustomerPreview view={saved.view} options={options} money={money} customer={draft.customer || ""} quote={saved.quote} />
        )}
        {p.renderInternal?.(shown, t)}
      </div>
    </EstimateFocusContext.Provider>
  );
}
