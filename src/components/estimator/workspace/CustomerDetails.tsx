"use client";

import { useState } from "react";
import Field from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import CreateExtraFields from "@/components/fields/CreateExtraFields";
import type { EstimateDraft } from "./useEstimateDraft";

const STANDARD_KEYS = ["ref", "name", "status", "currency", "margin_pct", "notes"];

/** Collapsed under the inputs: notes, and the workspace's own fields. */
export default function CustomerDetails({
  draft, disabled,
}: {
  draft: EstimateDraft;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(!!draft.accountId);
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>Notes and more details</summary>
      <div style={{ marginTop: 12 }}>
        <Field label="Notes" style={{ marginBottom: 12 }}>
          <Textarea value={draft.notes} onChange={(e) => draft.setNotes(e.target.value)} maxLength={5000} rows={3} placeholder="Assumptions, exclusions, who asked…" disabled={disabled} />
        </Field>
        <CreateExtraFields
          objectType="estimate"
          exclude={STANDARD_KEYS}
          values={draft.customData}
          onChange={(key, value, kind) => { if (kind === "custom") draft.setCustomData((d) => ({ ...d, [key]: value })); }}
        />
      </div>
    </details>
  );
}
