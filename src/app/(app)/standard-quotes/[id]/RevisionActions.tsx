"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { REVISION_TIPS } from "@/lib/revisions/tips";

const rev = (n: number) => `Rev. ${String(n).padStart(2, "0")}`;

/** Issue the working copy, or revise an issued quotation. Both open one small panel: the reason (required from the second
 *  revision on) and the one button. The routes decide everything; this only asks and reports. */
export default function RevisionActions({ quoteId, mode, workingRevision, pendingReason }: {
  quoteId: string;
  mode: "issue" | "revise";
  /** The revision the working copy will carry when issued (issue) or the one a revise will open (revise). */
  workingRevision: number;
  pendingReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(pendingReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsReason = mode === "revise" || workingRevision > 0;
  const label = mode === "issue" ? `Issue ${rev(workingRevision)}` : "Revise";

  async function run() {
    setBusy(true); setError("");
    const res = await fetch(`/api/standard-quotes/${quoteId}/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() || undefined }) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setError(res ? ((await res.json().catch(() => ({}))).error ?? "That did not work") : "Network error"); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={mode === "issue" ? "primary" : "secondary"} onClick={() => setOpen(true)} data-guide={`sq-${mode}-revision`}>{label}</Button>
      {open && (
        <SidePanel
          title={mode === "issue" ? `Issue ${rev(workingRevision)}` : `Revise: open ${rev(workingRevision)}`}
          onClose={() => setOpen(false)}
          footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={run} loading={busy} disabled={needsReason && reason.trim().length < 3}>{mode === "issue" ? "Issue" : "Open for changes"}</Button></>}
        >
          {needsReason && (
            <Field label={mode === "issue" ? "What changed?" : "Why is it being revised?"} info={mode === "issue" ? REVISION_TIPS.issue : REVISION_TIPS.revise} required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} style={{ minHeight: 90 }} autoFocus />
            </Field>
          )}
          {!needsReason && <p className="bpm-t-help" style={{ margin: 0 }}>{REVISION_TIPS.issueFirst}</p>}
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
        </SidePanel>
      )}
    </>
  );
}
