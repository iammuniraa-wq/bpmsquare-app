"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { CALL_KINDS, CALL_KIND_LABEL, CALL_LIMITS } from "@/lib/tender/calls";
import { TENDER_TIPS } from "@/lib/tender/tips";

// "Log a call": a side panel on a desktop, a bottom sheet on a phone (the shared SidePanel). One required field (what was discussed);
// the rest is optional and a next step only needs a date if you want it to be chased. Who logged it and when are the server's.

const emptyForm = { kind: "call", with_whom: "", occurred_at: "", summary: "", outcome: "", next_step: "", next_step_due: "" };

export function LogCallButton({ opportunityId, variant = "secondary", onLogged, initialOpen = false }: {
  opportunityId: string;
  variant?: "primary" | "secondary" | "quiet";
  /** Called after the call is saved. Without it the page is refreshed. */
  onLogged?: () => void;
  /** Lets a server render (and its test) show the open panel. The page never passes it. */
  initialOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setError("");
    if (!form.summary.trim()) { setError("Say what was discussed"); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { kind: form.kind, summary: form.summary };
      if (form.with_whom.trim()) body.with_whom = form.with_whom;
      if (form.occurred_at) body.occurred_at = new Date(form.occurred_at).toISOString();
      if (form.outcome.trim()) body.outcome = form.outcome;
      if (form.next_step.trim()) { body.next_step = form.next_step; if (form.next_step_due) body.next_step_due = form.next_step_due; }
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/calls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save"); return; }
      setForm(emptyForm); setOpen(false);
      // A parent that shows the list passes onLogged (it reloads the list and refreshes the page); a bare mount, like the Deal Room page, just refreshes.
      if (onLogged) onLogged(); else router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Button variant={variant} size="sm" data-guide="tender.call.log" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>Log a call</Button>
        <InfoTip label="Log a call">{TENDER_TIPS.callLog}</InfoTip>
      </span>
      {open && (
        <SidePanel
          title="Log a call" label="Log a call" onClose={() => setOpen(false)}
          footer={<Button variant="primary" loading={busy} data-guide="tender.call.save" style={{ minHeight: 44 }} onClick={save}>Save</Button>}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
            <div className="fg2">
              <Field label="Kind" guide="tender.call.kind">
                <Select value={form.kind} onChange={set("kind")}>{CALL_KINDS.map((k) => <option key={k} value={k}>{CALL_KIND_LABEL[k]}</option>)}</Select>
              </Field>
              <Field label="When" guide="tender.call.when"><Input type="datetime-local" value={form.occurred_at} onChange={set("occurred_at")} /></Field>
            </div>
            <Field label="With whom" guide="tender.call.with"><Input value={form.with_whom} onChange={set("with_whom")} maxLength={CALL_LIMITS.withMax} /></Field>
            <Field label="What was discussed" required guide="tender.call.summary"><Textarea value={form.summary} onChange={set("summary")} maxLength={CALL_LIMITS.summaryMax} style={{ minHeight: 90 }} /></Field>
            <Field label="Outcome" guide="tender.call.outcome"><Input value={form.outcome} onChange={set("outcome")} maxLength={CALL_LIMITS.outcomeMax} /></Field>
            <div className="fg2">
              <Field label="Next step" info={TENDER_TIPS.callNextStep} guide="tender.call.next_step"><Input value={form.next_step} onChange={set("next_step")} maxLength={CALL_LIMITS.nextStepMax} /></Field>
              <Field label="Due" guide="tender.call.due"><Input type="date" value={form.next_step_due} onChange={set("next_step_due")} disabled={!form.next_step.trim()} /></Field>
            </div>
          </div>
        </SidePanel>
      )}
    </>
  );
}
