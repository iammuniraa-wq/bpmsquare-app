"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { Select, Textarea } from "@/components/ui/Input";
import type { IntakeProposal } from "@/lib/estimator/ai";
import type { PickMatch, PickLevel } from "@/lib/estimator/pick";
import Chip from "./Chip";
import { reviewCounts, reviewRows } from "./intakeReview";
import { wordsFor } from "./layoutKind";
import type { WorkspaceTemplate } from "./types";

type PickJson = { template_id: string | null; name: string | null; confidence: number; level: PickLevel; alternatives: PickMatch[]; not_sure: boolean; reason: string | null };
type Reading = { templateId: string; proposal: IntakeProposal };

const LEVEL_TEXT: Record<PickLevel, string> = { high: "sure", medium: "fairly sure", low: "not sure" };

/**
 * Step 1: start from the customer's email. Paste it, the AI picks the template (when the
 * workspace has several), reads the email against that template's inputs, and the page shows
 * a review table: every input as Found, Likely or Missing with the email's own words. The page
 * is filled in for the person to check, a Missing input keeps the form's default only as a
 * marked placeholder, and nothing is saved until Create quote or Save as draft is pressed.
 * The manual inputs are always there, so a workspace without AI loses nothing.
 */
export default function EmailIntake({
  templates, template, autoPick, onTemplate, onApply,
}: {
  templates: readonly WorkspaceTemplate[];
  template: WorkspaceTemplate;
  /** Arrived from "start from the customer's email": let the AI choose the template. */
  autoPick: boolean;
  onTemplate: (id: string) => void;
  onApply: (proposal: IntakeProposal) => void;
}) {
  const id = useId();
  const canChoose = templates.length > 1;
  const [text, setText] = useState("");
  const [choose, setChoose] = useState(autoPick && canChoose);
  const [busy, setBusy] = useState<null | "pick" | "read">(null);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [pick, setPick] = useState<PickJson | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [showAll, setShowAll] = useState(false);

  // The async steps below outlive the render that started them; they must call the CURRENT callbacks
  // (after a template switch the page's draft belongs to the new template).
  const latest = useRef({ onApply, onTemplate });
  useEffect(() => { latest.current = { onApply, onTemplate }; });
  const pageTemplate = useRef(template.id);
  useEffect(() => { pageTemplate.current = template.id; });

  async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 503 && json.configured === false) { setNotConfigured(true); return { ok: false, json }; }
    if (!res.ok) { setError(typeof json.error === "string" ? json.error : "Could not read the email."); return { ok: false, json }; }
    return { ok: true, json };
  }

  async function readFor(templateId: string) {
    setBusy("read");
    const r = await post("/api/estimates/ai/intake", { template_id: templateId, text });
    if (!r.ok) return;
    const proposal = r.json as unknown as IntakeProposal;
    // Wait for the page to be on this template before filling it in.
    for (let i = 0; i < 20 && pageTemplate.current !== templateId; i++) await new Promise((ok) => setTimeout(ok, 50));
    setReading({ templateId, proposal });
    latest.current.onApply(proposal);
  }

  async function run() {
    setBusy(null); setError(""); setPick(null);
    try {
      let target = template.id;
      if (choose && canChoose) {
        setBusy("pick");
        const p = await post("/api/estimates/ai/pick", { text });
        if (!p.ok) return;
        const found = p.json as unknown as PickJson;
        setPick(found);
        if (found.template_id && templates.some((t) => t.id === found.template_id)) {
          target = found.template_id;
          if (target !== template.id) latest.current.onTemplate(target);
        }
      }
      await readFor(target);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function switchTo(templateId: string) {
    if (templateId === template.id) return;
    setError("");
    latest.current.onTemplate(templateId);
    try { await readFor(templateId); } catch { setError("Could not reach the server. Try again."); } finally { setBusy(null); }
  }

  const rows = useMemo(() => (reading && reading.templateId === template.id ? reviewRows(template.inputs, reading.proposal) : []), [reading, template]);
  const counts = reviewCounts(rows);
  const shownRows = showAll ? rows : rows.slice(0, 8);
  const words = wordsFor(template.geometry);

  return (
    <Card padding={16}>
      <h2 className="bpm-t-section" style={{ marginBottom: 8 }}>
        1. Start from the customer&apos;s email <small style={{ fontWeight: 500, color: "var(--muted)", fontSize: 12.5, marginLeft: 6 }}>or fill in the details below</small>
      </h2>
      {notConfigured ? (
        <div role="status" className="est-note">Reading emails needs AI, which is not switched on for this workspace. Fill in the details below instead.</div>
      ) : (
        <>
          <label htmlFor={id} className="bpm-t-label" style={{ display: "block", marginBottom: 6 }}>Paste the email</label>
          <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} rows={5} placeholder={words.placeholder} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 10 }}>
            <Button variant="primary" size="sm" loading={busy !== null} disabled={busy !== null || text.trim() === ""} onClick={run}>
              {choose && canChoose ? "Choose the template and read" : "Read the email"}
            </Button>
            {canChoose && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32 }}>
                  <input type="checkbox" checked={choose} onChange={(e) => setChoose(e.target.checked)} />
                  <span className="bpm-t-body">Let AI choose the template</span>
                </label>
                <InfoTip label="Let AI choose the template">It compares the email with your templates and picks one, or says it is not sure. You can always switch.</InfoTip>
              </span>
            )}
          </div>
          {busy && <div role="status" className="bpm-t-help" style={{ marginTop: 8 }}>{busy === "pick" ? "Choosing the template…" : "Reading the email…"}</div>}
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginTop: 8 }}>{error}</div>}

          {pick && (
            <div className="est-chips" role="status" aria-live="polite" aria-label="Template chosen">
              {pick.template_id ? (
                <Chip tone={pick.level === "high" ? "green" : "blue"} label={`Template: ${pick.name} (${LEVEL_TEXT[pick.level]})`} />
              ) : (
                <>
                  <Chip tone="amber" label={`Not sure which template this is. Using ${template.name}.`} />
                  {pick.alternatives.map((a) => (
                    <button key={a.template_id} type="button" className="est-opt" style={{ padding: "3px 10px", borderRadius: 14 }} disabled={busy !== null}
                      onClick={() => void switchTo(a.template_id)}>
                      {a.name} {Math.round(a.confidence * 100)}%
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ marginTop: 12 }} aria-label="What was read from the email">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 6 }}>
                {canChoose && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="bpm-t-label">Template</span>
                    <Select value={template.id} disabled={busy !== null} onChange={(e) => void switchTo(e.target.value)} style={{ maxWidth: 260 }}>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  </label>
                )}
                <Chip tone="green" label={`${counts.found} found`} />
                <Chip tone="blue" label={`${counts.likely} likely`} />
                <Chip tone="amber" label={`${counts.missing} missing`} />
              </div>
              <table className="est-review">
                <thead><tr><th>Detail</th><th>Read as</th><th>Source in the email</th></tr></thead>
                <tbody>
                  {shownRows.map((r) => (
                    <tr key={r.key}>
                      <td><Chip tone={r.tone} label={r.statusLabel} /> <span style={{ marginLeft: 6 }}>{r.label}</span></td>
                      <td>{r.status === "missing" ? <span className="est-src">Needs your answer (form shows {r.placeholder})</span> : r.value}</td>
                      <td>{r.source ? <span className="est-src">&ldquo;{r.source}&rdquo;</span> : r.status === "missing" ? "" : <span className="est-src">implied</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && (
                <Button variant="quiet" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${rows.length}`}</Button>
              )}
              <div className="bpm-t-help" style={{ marginTop: 6 }}>Nothing is saved yet. Check the details below, then press Create quote or Save as draft.</div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
