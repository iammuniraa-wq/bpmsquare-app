"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/Input";
import { ABM_PROGRESS, PROGRESS_LABEL, type AbmProgress } from "@/lib/abm/types";
import Modal from "../../../Modal";

/**
 * The target account's one primary action. A person setting progress always
 * gives a reason (the owner's rule); the reason and who made the change are
 * kept and shown wherever Progress is explained.
 */
export default function UpdateProgressButton({ targetId, current }: { targetId: string; current: AbmProgress }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<AbmProgress>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (to === current) { setOpen(false); return; }
    if (!reason.trim()) { setError("Say why you are changing it. A manual change always needs a reason."); return; }
    setBusy(true); setError("");
    const res = await fetch(`/api/abm/targets/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress: to, progress_reason: reason }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not update progress."); return; }
    setOpen(false); setReason("");
    router.refresh();
  }

  return (
    <>
      <Button variant="primary" onClick={() => { setTo(current); setReason(""); setError(""); setOpen(true); }}>Update progress</Button>
      {open && (
        <Modal title="Update progress" onClose={() => setOpen(false)}>
          <Field label="Progress" hint="The rules only move a company forward. Use this to set what only a person can know, or to correct it.">
            <Select value={to} onChange={(e) => setTo(e.target.value as AbmProgress)}>
              {ABM_PROGRESS.map((p) => <option key={p} value={p}>{PROGRESS_LABEL[p]}</option>)}
            </Select>
          </Field>
          {to !== current && (
            <Field label={to === "dropped" ? "Why is it being dropped?" : "Why?"} required hint="Kept with your name and the date.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={to === "dropped" ? "e.g. Awarded to a competitor" : "e.g. Site meeting on 3 Nov"} autoFocus />
            </Field>
          )}
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>Save</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
