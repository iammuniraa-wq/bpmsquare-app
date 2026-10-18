"use client";

import { useId, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import type { IntakeProposal } from "@/lib/estimator/ai";
import type { TemplateInput } from "@/lib/estimator/types";
import Chip from "./Chip";
import { assumedChips, understoodChips } from "./intakeChips";

/**
 * Step 1: start from the customer's email. "Fill in from the email" asks the
 * AI intake route for proposed inputs; the page fills them in, shows what was
 * understood (blue) and what was assumed (amber), and saves nothing. The
 * manual inputs below are always there, so a workspace without AI loses nothing.
 */
export default function EmailIntake({
  templateId, inputs, onApply,
}: {
  templateId: string;
  inputs: readonly TemplateInput[];
  onApply: (proposal: IntakeProposal) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [result, setResult] = useState<IntakeProposal | null>(null);

  async function read() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/estimates/ai/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503 && json.configured === false) { setNotConfigured(true); return; }
      if (!res.ok) { setError(json.error ?? "Could not read the email."); return; }
      setResult(json as IntakeProposal);
      onApply(json as IntakeProposal);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const understood = result ? understoodChips(inputs, result) : [];
  const assumed = result ? assumedChips(inputs, result) : [];

  return (
    <Card padding={16}>
      <h2 className="bpm-t-section" style={{ marginBottom: 8 }}>
        1. Start from the customer&apos;s email <small style={{ fontWeight: 500, color: "var(--muted)", fontSize: 12.5, marginLeft: 6 }}>or fill in the details below</small>
      </h2>
      {notConfigured ? (
        <div role="status" className="est-note">Reading emails needs AI, which is not switched on for this workspace. Fill in the details below instead.</div>
      ) : (
        <>
          <label htmlFor={id} className="bpm-t-help" style={{ display: "block", marginBottom: 6 }}>
            Paste or forward the customer&apos;s email. The details are read for you to check; nothing is saved until you press Create quote.
          </label>
          <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} rows={5}
            placeholder="Hi, we'd like a price for a villa in Riyadh. Two floors, about 180 m² each, with a 70 m boundary wall…" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
            <Button variant="primary" size="sm" loading={busy} disabled={busy || text.trim() === ""} onClick={read}>Fill in from the email</Button>
            <span className="bpm-t-help">Read by AI. You always review the numbers.</span>
          </div>
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginTop: 8 }}>{error}</div>}
          {result && (
            <div className="est-chips" role="status" aria-live="polite" aria-label="What was read from the email">
              {understood.length === 0 && <span className="bpm-t-help">Nothing in the email matched the details below.</span>}
              {understood.map((t) => <Chip key={`u-${t}`} label={t} tone="blue" />)}
              {assumed.map((t) => <Chip key={`a-${t}`} label={`Assumed: ${t}`} tone="amber" />)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
