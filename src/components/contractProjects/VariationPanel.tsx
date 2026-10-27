"use client";

import { useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import { day, signedMoney } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { VARIATION_LIMITS, VARIATION_STATUS_LABEL, VARIATION_TONE, isEditable, isRemovable } from "@/lib/contractProjects/variations";
import type { VariationView } from "@/lib/contractProjects/variationsServer";

// Add or look at one variation: a side panel on a desktop, a bottom sheet on a phone (the shared SidePanel). What a person can do depends on
// where the variation stands: a draft (or rejected) one is edited, sent for approval or removed; one waiting for approval is decided by an
// approver or withdrawn by the person who sent it; an approved one is read-only. The server decides again on every call.

type Form = { title: string; description: string; change_request_ref: string; amount: string; cost_amount: string; note: string };
const blank: Form = { title: "", description: "", change_request_ref: "", amount: "", cost_amount: "", note: "" };
const fromVariation = (v: VariationView): Form => ({
  title: v.title, description: v.description ?? "", change_request_ref: v.change_request_ref ?? "", amount: v.amount ? String(v.amount) : "", cost_amount: v.cost_amount ? String(v.cost_amount) : "", note: v.note ?? "",
});

export type VariationOutcome = { status: "approved" | "rejected"; contract_value?: number; revision: "started" | "already_open" | "no_baseline" | "no_reason" | "failed" | null; revision_no?: number };

export default function VariationPanel({ projectId, variation, currency, canEdit, onClose, onChanged, onOutcome }: {
  projectId: string;
  /** Absent = a new variation. */
  variation?: VariationView;
  currency: string | null;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOutcome?: (o: VariationOutcome) => void;
}) {
  const [form, setForm] = useState<Form>(variation ? fromVariation(variation) : blank);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const status = variation?.status ?? "draft";
  const editable = canEdit && isEditable(status);
  const base = `/api/contract-projects/${projectId}/variations`;

  async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) setError(typeof json.error === "string" ? json.error : "That did not work");
    return { ok: res.ok, json };
  }

  const payload = () => ({
    title: form.title, description: form.description, change_request_ref: form.change_request_ref, note: form.note,
    amount: form.amount.trim() === "" ? 0 : form.amount, cost_amount: form.cost_amount.trim() === "" ? 0 : form.cost_amount,
  });

  /** Saves the form (a new variation or an edit). Returns the variation id, or null when it failed. */
  async function save(): Promise<string | null> {
    if (!form.title.trim()) { setError("Give the variation a title"); return null; }
    const r = variation ? await call(`${base}/${variation.id}`, "PATCH", payload()) : await call(base, "POST", payload());
    if (!r.ok) return null;
    return variation ? variation.id : String(r.json.id ?? "");
  }

  async function run(name: string, fn: () => Promise<boolean>) {
    setError(""); setBusy(name);
    try { if (await fn()) onChanged(); } finally { setBusy(""); }
  }

  const onSave = () => run("save", async () => (await save()) !== null);
  const onSend = () => run("send", async () => {
    const id = await save();
    if (!id) return false;
    return (await call(`${base}/${id}`, "PATCH", { action: "submit" })).ok;
  });
  const onRemove = () => run("remove", async () => (await call(`${base}/${variation!.id}`, "DELETE")).ok);
  const onWithdraw = () => run("withdraw", async () => (await call(`${base}/${variation!.id}`, "PATCH", { action: "withdraw" })).ok);
  const onDecide = (action: "approve" | "reject") => run(action, async () => {
    const r = await call(`${base}/${variation!.id}`, "PATCH", { action, comment });
    if (r.ok && r.json.outcome) onOutcome?.(r.json.outcome as VariationOutcome);
    return r.ok;
  });

  const title = variation ? (variation.ref ?? "Variation") : "Add variation";
  const footer = editable ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
      <Button variant="primary" loading={busy === "save"} disabled={!!busy} data-guide="cp.variation.save" style={{ minHeight: 44 }} onClick={onSave}>Save</Button>
      {variation && <Button variant="secondary" loading={busy === "send"} disabled={!!busy} data-guide="cp.variation.send" style={{ minHeight: 44 }} onClick={onSend}>Send for approval</Button>}
      {variation && isRemovable(status) && <Button variant="quiet" loading={busy === "remove"} disabled={!!busy} data-guide="cp.variation.remove" style={{ minHeight: 44 }} onClick={onRemove}>Remove</Button>}
    </div>
  ) : undefined;

  return (
    <SidePanel title={title} subtitle={variation ? <StatusPill label={VARIATION_STATUS_LABEL[status]} tone={VARIATION_TONE[status]} /> : undefined} label={title} onClose={onClose} footer={footer}>
      <div className="bpm-tap" data-guide="cp.variation.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        {status === "rejected" && variation && <div role="status" style={{ fontSize: 13, color: "var(--amberink)" }}>This variation was rejected. Change it and send it again.</div>}

        <Field label="Title" required guide="cp.variation.field.title"><Input value={form.title} onChange={set("title")} maxLength={VARIATION_LIMITS.titleMax} disabled={!editable} autoFocus={editable} /></Field>
        <div className="fg2">
          <Field label="Change in contract value" info={PROJECT_TIPS.variationAmount} guide="cp.variation.field.amount">
            <Input value={form.amount} onChange={set("amount")} inputMode="decimal" placeholder="0" disabled={!editable} />
          </Field>
          <Field label="Change in cost" info={PROJECT_TIPS.variationCost} guide="cp.variation.field.cost">
            <Input value={form.cost_amount} onChange={set("cost_amount")} inputMode="decimal" placeholder="0" disabled={!editable} />
          </Field>
        </div>
        <Field label="Change request" info={PROJECT_TIPS.changeRequest} guide="cp.variation.field.change_request"><Input value={form.change_request_ref} onChange={set("change_request_ref")} maxLength={VARIATION_LIMITS.changeRefMax} disabled={!editable} /></Field>
        <Field label="What changed" guide="cp.variation.field.description"><Textarea value={form.description} onChange={set("description")} maxLength={VARIATION_LIMITS.descriptionMax} style={{ minHeight: 84 }} disabled={!editable} /></Field>
        <Field label="Note" guide="cp.variation.field.note"><Textarea value={form.note} onChange={set("note")} maxLength={VARIATION_LIMITS.noteMax} style={{ minHeight: 60 }} disabled={!editable} /></Field>

        {variation && status === "submitted" && (
          <div data-guide="cp.variation.decision" style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
            <div style={{ fontSize: 13, color: c.ink }}>
              Waiting for approval
              <span style={{ color: c.hint }}> · {[variation.submitted_by_name, variation.submitted_at ? day(variation.submitted_at) : null].filter(Boolean).join(" · ")}</span>
            </div>
            {variation.can_decide && !rejecting && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="primary" loading={busy === "approve"} disabled={!!busy} data-guide="cp.variation.approve" style={{ minHeight: 44 }} onClick={() => onDecide("approve")}>Approve</Button>
                <Button variant="secondary" disabled={!!busy} data-guide="cp.variation.reject" style={{ minHeight: 44 }} onClick={() => setRejecting(true)}>Reject</Button>
              </div>
            )}
            {variation.can_decide && rejecting && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is it rejected?" aria-label="Reason for rejecting" maxLength={1000} />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="danger" loading={busy === "reject"} disabled={!!busy} data-guide="cp.variation.reject_confirm" style={{ minHeight: 44 }} onClick={() => onDecide("reject")}>Reject</Button>
                  <Button variant="quiet" disabled={!!busy} style={{ minHeight: 44 }} onClick={() => setRejecting(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {variation.mine && canEdit && <div><Button variant="quiet" loading={busy === "withdraw"} disabled={!!busy} data-guide="cp.variation.withdraw" style={{ minHeight: 44 }} onClick={onWithdraw}>Withdraw the request</Button></div>}
            {!variation.can_decide && !variation.mine && <div style={{ fontSize: 12, color: c.hint }}>An approver will decide it.</div>}
          </div>
        )}

        {variation && status === "approved" && (
          <div style={{ fontSize: 13, color: c.ink, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
            Approved{variation.decided_by_name ? ` by ${variation.decided_by_name}` : ""}{variation.decided_at ? ` · ${day(variation.decided_at)}` : ""}. Contract value {signedMoney(variation.amount, currency)}.
            {variation.revision_no !== null && (
              <div style={{ marginTop: 4 }}>
                <Link href={`${ROUTES.contractProject(projectId)}?tab=revisions`} data-guide="cp.variation.revision_link" style={{ color: c.accent, display: "inline-flex", alignItems: "center", minHeight: 44 }}>Budget revision {variation.revision_no}</Link>
              </div>
            )}
          </div>
        )}
        {variation && status === "rejected" && variation.decided_by_name && <div style={{ fontSize: 12.5, color: c.hint }}>Rejected by {variation.decided_by_name}{variation.decided_at ? ` · ${day(variation.decided_at)}` : ""}.</div>}
      </div>
    </SidePanel>
  );
}
