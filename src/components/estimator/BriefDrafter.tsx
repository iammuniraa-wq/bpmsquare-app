"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import type { IntakeProposal } from "@/lib/estimator/ai";

/**
 * "Draft inputs from a brief": paste an email or brief, the server proposes
 * values for the chosen template's inputs, and the form below is filled for
 * review. Nothing is saved until the person presses Calculate and save.
 */
export default function BriefDrafter({
  templateId, onApply,
}: {
  templateId: string;
  onApply: (proposal: IntakeProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [result, setResult] = useState<IntakeProposal | null>(null);

  async function draft() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/estimates/ai/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503 && json.configured === false) { setNotConfigured(true); return; }
      if (!res.ok) { setError(json.error ?? "Could not read the brief."); return; }
      setResult(json as IntakeProposal);
      onApply(json as IntakeProposal);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Card padding={14}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="bpm-t-help" style={{ flex: "1 1 240px" }}>Have a brief or an email from the customer? Let AI propose the inputs, then check them.</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>Draft inputs from a brief</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Draft inputs from a brief" padding={18}
      action={<Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>Close</Button>}>
      {notConfigured ? (
        <div role="status" className="bpm-t-body">AI is not set up for this workspace. Enter the inputs below by hand.</div>
      ) : (
        <>
          <label htmlFor="est-brief" className="bpm-t-help" style={{ display: "block", marginBottom: 6 }}>
            Paste the customer&apos;s email or brief (text only, up to 20,000 characters). It is read by an AI model on our server; only this text and the template&apos;s input names are sent.
          </label>
          <Textarea id="est-brief" value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} rows={6} placeholder="e.g. We want a two-storey villa, about 180 m² per floor, with a 70 m boundary wall…" />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <Button type="button" variant="primary" size="sm" loading={busy} disabled={busy || text.trim() === ""} onClick={draft}>Draft the inputs</Button>
            {error && <span role="alert" style={{ color: "var(--err-ink)", fontSize: 13 }}>{error}</span>}
          </div>
          {result && (
            <div role="status" style={{ marginTop: 12 }}>
              <div className="bpm-t-label">Drafted {Object.keys(result.values).length} inputs. Not saved: check the fields below, then Calculate and save.</div>
              {result.assumptions.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--muted)" }}>
                  {result.assumptions.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
