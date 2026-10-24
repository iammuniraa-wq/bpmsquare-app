"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { Select, Textarea } from "@/components/ui/Input";
import type { IntakeProposal } from "@/lib/estimator/ai";
import type { PickMatch, PickLevel } from "@/lib/estimator/pick";
import type { IntakeResult } from "@/lib/estimator/aiRun";
import type { DxfModel } from "@/lib/estimator/drawing/model";
import { INTAKE_LIMITS, KIND_LABEL, LIMITS_TEXT, type FileKind } from "@/lib/estimator/intakeFiles/kinds";
import { QUALITY_LABEL, type QualityLabel } from "@/lib/inbox/types";
import Chip from "./Chip";
import { fileOrigin, reviewCounts, reviewRows } from "./intakeReview";
import { wordsFor } from "./layoutKind";
import type { WorkspaceTemplate } from "./types";

// The drawing picture (and its geometry code) is only fetched when a DXF is opened.
const DxfViewer = dynamic(() => import("@/components/estimator/drawing/DxfViewer"), {
  ssr: false,
  loading: () => <div className="bpm-t-help" style={{ padding: 16 }}>Loading the drawing…</div>,
});

/** Metres per drawing unit, for a drawing that does not say (or says it wrongly). "" = what the drawing states. */
const DRAWING_UNITS: readonly { value: string; label: string }[] = [
  { value: "", label: "As the drawing says" }, { value: "0.001", label: "Millimetres" }, { value: "0.01", label: "Centimetres" },
  { value: "1", label: "Metres" }, { value: "0.3048", label: "Feet" }, { value: "0.0254", label: "Inches" },
];
type DrawingView = { id: string; name: string; model: DxfModel | null; note: string | null };

type PickJson = { template_id: string | null; name: string | null; confidence: number; level: PickLevel; alternatives: PickMatch[]; not_sure: boolean; reason: string | null };
type Reading = { templateId: string; proposal: IntakeResult };
type Attachment = { id: string; name: string; kind: FileKind; size_bytes: number; quality: QualityLabel; quality_note: string | null; readable: boolean; note: string | null };

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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
  templates, template, autoPick, onTemplate, onApply, initialText = "", emailId,
}: {
  templates: readonly WorkspaceTemplate[];
  template: WorkspaceTemplate;
  /** Arrived from "start from the customer's email": let the AI choose the template. */
  autoPick: boolean;
  onTemplate: (id: string) => void;
  onApply: (proposal: IntakeProposal) => void;
  /** The email, already in the box (when the estimate is started from the shared Inbox). */
  initialText?: string;
  /** The Inbox message the estimate is started from: its attachments are offered to be read with the text. */
  emailId?: string;
}) {
  const id = useId();
  const canChoose = templates.length > 1;
  const [text, setText] = useState(initialText);
  const [choose, setChoose] = useState(autoPick && canChoose);
  const [busy, setBusy] = useState<null | "pick" | "read">(null);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [pick, setPick] = useState<PickJson | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [unit, setUnit] = useState("");
  const [drawing, setDrawing] = useState<DrawingView | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [drawingBusy, setDrawingBusy] = useState(false);

  // The message's files, listed once: the readable ones start ticked (up to the cap), the others say why not.
  useEffect(() => {
    if (!emailId) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/estimates/ai/intake?email_id=${encodeURIComponent(emailId)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { files?: Attachment[] };
        if (!live || !Array.isArray(json.files)) return;
        setAttachments(json.files);
        setTicked(new Set(json.files.filter((f) => f.readable).slice(0, INTAKE_LIMITS.maxFiles).map((f) => f.id)));
      } catch { /* no files listed: the email text alone still reads */ }
    })();
    return () => { live = false; };
  }, [emailId]);

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
    const withFiles = !!emailId && ticked.size > 0;
    const r = await post("/api/estimates/ai/intake", {
      template_id: templateId, text,
      ...(withFiles ? { email_id: emailId, attachment_ids: [...ticked], ...(unit ? { unit_factor: Number(unit) } : {}) } : {}),
    });
    if (!r.ok) return;
    const proposal = r.json as unknown as IntakeResult;
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

  function toggle(id: string, on: boolean) {
    setTicked((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; });
  }

  // The signed link is made on demand (it lasts a minute) and opens in a new tab; a PDF opens at its page.
  async function openPage(name: string, page: number | null) {
    const id = reading?.proposal.files?.find((f) => f.name === name)?.id;
    if (!id) return;
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await fetch(`/api/inbox/attachments/${encodeURIComponent(id)}?view=1`);
      const json = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !json.url) throw new Error("no link");
      const url = `${json.url}${page ? `#page=${page}` : ""}`;
      if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, "_blank", "noopener");
    } catch {
      tab?.close();
      setError("Could not open that file. Try again.");
    }
  }

  // Opens a DXF attachment in the viewer (measured on the server), optionally lighting up the layers a number came from.
  async function showDrawing(attachmentId: string, name: string, layers: string[]) {
    setHighlight(layers);
    if (drawing?.id === attachmentId && drawing.model) return;
    if (!emailId) return;
    setDrawingBusy(true); setError("");
    try {
      const res = await fetch("/api/estimates/drawing/measure", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: emailId, attachment_id: attachmentId, ...(unit ? { unit_factor: Number(unit) } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { model?: DxfModel | null; modelNote?: string | null; error?: string };
      if (!res.ok) { setError(json.error ?? "Could not open the drawing."); return; }
      setDrawing({ id: attachmentId, name, model: json.model ?? null, note: json.modelNote ?? null });
    } catch {
      setError("Could not open the drawing. Try again.");
    } finally {
      setDrawingBusy(false);
    }
  }

  const hasDxfTicked = attachments.some((a) => a.kind === "dxf" && ticked.has(a.id));
  const rows = useMemo(() => (reading && reading.templateId === template.id ? reviewRows(template.inputs, reading.proposal) : []), [reading, template]);
  const counts = reviewCounts(rows);
  const hasFileRows = rows.some((r) => r.file);
  const notRead = reading?.proposal.files?.filter((f) => f.status === "skipped") ?? [];
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
          {attachments.length > 0 && (
            <div role="group" aria-label="Attached files to read" style={{ marginTop: 10 }}>
              <div className="bpm-t-label" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                Attached files
                <InfoTip label="Attached files">{LIMITS_TEXT}</InfoTip>
              </div>
              {attachments.map((a) => {
                const on = ticked.has(a.id);
                const atCap = !on && ticked.size >= INTAKE_LIMITS.maxFiles;
                return (
                  <label key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 44, padding: "6px 0", opacity: a.readable ? 1 : 0.7 }}>
                    <input type="checkbox" checked={on} disabled={!a.readable || atCap || busy !== null} onChange={(e) => toggle(a.id, e.target.checked)} style={{ marginTop: 3 }} />
                    <span style={{ minWidth: 0 }}>
                      <span className="bpm-t-body" style={{ overflowWrap: "anywhere" }}>{a.name}</span>
                      <span className="bpm-t-help" style={{ display: "block" }}>
                        {KIND_LABEL[a.kind]} · {sizeText(a.size_bytes)}{a.readable ? ` · ${QUALITY_LABEL[a.quality]}` : ""}{a.note ? ` · ${a.note}` : ""}
                      </span>
                    </span>
                    {a.kind === "dxf" && a.readable && (
                      <Button variant="quiet" size="sm" disabled={drawingBusy} onClick={(ev) => { ev.preventDefault(); void showDrawing(a.id, a.name, []); }}>View drawing</Button>
                    )}
                  </label>
                );
              })}
            </div>
          )}
      {drawing && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="bpm-t-label">{drawing.name}</span>
            <Button variant="quiet" size="sm" onClick={() => { setDrawing(null); setHighlight([]); }}>Close drawing</Button>
          </div>
          {drawing.model ? <DxfViewer model={drawing.model} highlightLayers={highlight} note={drawing.note} /> : <div className="bpm-t-help">{drawing.note ?? "This drawing is too large to show here. The measurements above come from the whole drawing."}</div>}
        </div>
      )}
          {hasDxfTicked && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <span className="bpm-t-label">Drawing units</span>
              <InfoTip label="Drawing units">Most drawings state their units. Choose one here only when the drawing does not, or states them wrongly: every length and area is measured in it.</InfoTip>
              <Select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ maxWidth: 200 }}>
                {DRAWING_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </Select>
            </label>
          )}
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
                <thead><tr><th>Detail</th><th>Read as</th><th>{hasFileRows ? "Source" : "Source in the email"}</th></tr></thead>
                <tbody>
                  {shownRows.map((r) => {
                    const origin = fileOrigin(r);
                    return (
                      <tr key={r.key}>
                        <td><Chip tone={r.tone} label={r.statusLabel} /> <span style={{ marginLeft: 6 }}>{r.label}</span></td>
                        <td>{r.status === "missing" ? <span className="est-src">Needs your answer (form shows {r.placeholder})</span> : r.value}</td>
                        <td>
                          {origin && <span className="est-src" style={{ fontStyle: "normal", fontWeight: 600, display: "block" }}>{origin}</span>}
                          {r.source ? <span className="est-src">&ldquo;{r.source}&rdquo;</span> : r.status === "missing" ? "" : <span className="est-src">implied</span>}
                          {origin && r.file && r.layer && (
                            <Button variant="quiet" size="sm" disabled={drawingBusy}
                              onClick={() => { const id = reading?.proposal.files?.find((f) => f.name === r.file)?.id; if (id) void showDrawing(id, r.file!, r.layer!.split(", ")); }}>
                              Show on drawing
                            </Button>
                          )}
                          {origin && r.file && !r.layer && (
                            <Button variant="quiet" size="sm" onClick={() => void openPage(r.file!, r.page)} aria-label={r.page ? `Open page ${r.page} of ${r.file}` : `Open ${r.file}`}>
                              {r.page ? "Open page" : "Open file"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {notRead.length > 0 && (
                <div role="status" style={{ marginTop: 8, fontSize: 13, color: "var(--err-ink)" }}>
                  {notRead.map((f) => <div key={f.id}>Not read: {f.name}. {f.note}</div>)}
                </div>
              )}
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
