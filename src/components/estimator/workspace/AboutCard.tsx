"use client";

import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import InputsForm from "@/components/estimator/InputsForm";
import type { InputIssue } from "@/components/estimator/InputsForm";
import type { EstimateDraft } from "./useEstimateDraft";
import { wordsFor } from "./layoutKind";
import { ESTIMATE_TIPS } from "@/lib/estimator/tips";

/**
 * Step 2: the plain inputs, generated from the template. Every change feeds the
 * live preview, so the model and the price follow as the person types. The
 * margin sits here because the price depends on it; the customer never sees it.
 */
export default function AboutCard({
  draft, issues, disabled, showCustomer, extra, children,
}: {
  draft: EstimateDraft;
  issues: InputIssue[];
  disabled: boolean;
  /** New estimates name the customer here; a saved one is renamed under Details. */
  showCustomer: boolean;
  /** Collapsed customer details (account, contact, notes). */
  extra?: React.ReactNode;
  /** Actions under the form (save changes, discard). */
  children?: React.ReactNode;
}) {
  const t = draft.template;
  return (
    <Card title={`2. ${wordsFor(t?.geometry).about}`} info={disabled ? undefined : ESTIMATE_TIPS.about} padding={16}>
      {showCustomer && (
        <Field label="Customer or project" info={ESTIMATE_TIPS.name}>
          <Input value={draft.customer} onChange={(e) => draft.setCustomer(e.target.value)} maxLength={200} placeholder="e.g. Khalid Al-Rashid, Riyadh yard" disabled={disabled} />
        </Field>
      )}
      {t && <InputsForm inputs={t.inputs} values={draft.values} onChange={draft.setValue} issues={issues} disabled={disabled} notes={draft.flags} />}
      <Field label="Margin on cost (%)" info={ESTIMATE_TIPS.margin} style={{ marginBottom: extra || children ? 16 : 0 }}>
        <Input type="number" inputMode="decimal" step="any" min={0} max={1000} value={draft.margin} onChange={(e) => draft.setMargin(e.target.value)} disabled={disabled} />
      </Field>
      {extra}
      {children}
    </Card>
  );
}
