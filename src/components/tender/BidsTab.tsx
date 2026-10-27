"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { submitWarnings, type SubmitFacts } from "@/lib/tender/submitChecks";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { toneForDelta } from "@/lib/ui/tone";
import SettingsSection from "@/components/settings/SettingsSection";
import { BID_LIMITS, BID_REVISE_STAGES, BID_SUBMIT_STAGES, deltaText, type BidDiff, type BidLine, type BidsData } from "@/lib/tender/bids/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { LinkedQuote } from "@/lib/sales/opportunityServer";
import { toneTokens } from "@/lib/ui/tone";
import { bidsUrl, mergeBids, reloadAfterSave } from "./refreshAfterSave";
import BidDocuments from "./BidDocuments";

// The Bid tab of a tender deal (docs/design/gcc-tender-deals.md sections 15 and 26): a readiness line that warns and never blocks,
// Submit bid / Revise bid, the numbered versions that never change, a comparison of any two, and "Documents we send" (the priced BOQ,
// the answer sheet and the Standard Quotes made from a version). A version holds the deal's lines and total as they were; it never
// holds a cost or a markup. The rules (which stage may submit, whether a reason is needed) are the server's; this only draws them.

const fmtStamp = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const SHOWN_VERSIONS = 5;
const SHOWN_LINES = 8;

export default function BidsTab({ opportunityId, data: pageData, stage, outcome, fmt, onError, onNotice, onChanged, checks, quotes = [], canMakeQuote = false, startSignal = 0, initialCompare = null, initialSubmitOpen = false }: {
  opportunityId: string;
  data: BidsData;
  stage: string;
  outcome: string;
  fmt: (n: number) => string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** Called after a submit or a reopen is saved (and, for a submit, the versions reloaded), so the page's stage and header facts refresh. */
  onChanged?: () => void;
  /**
   * What the deal already knows, for the warnings shown before a bid is submitted or revised. Absent: no dialog. The warnings never
   * block; the person can always go on.
   */
  checks?: Pick<SubmitFacts, "priceValidityDays" | "approvedGo" | "guarantee"> & { unpricedFromLines: number };
  /** The Standard Quotes already made from this deal, newest first (listed under "Documents we send"). */
  quotes?: LinkedQuote[];
  /** Standard Quotes are on in this workspace and the caller may change the deal: "Make a Standard Quote from this version" is offered. */
  canMakeQuote?: boolean;
  /** The header's Submit bid / Revise bid button counts this up; each increase starts the same flow as the button on this tab. */
  startSignal?: number;
  /** Lets a server render (and its test) show a finished comparison. The page never passes it. */
  initialCompare?: { from: number; to: number; diff: BidDiff } | null;
  initialSubmitOpen?: boolean;
}) {
  // The versions follow a submit at once (reloaded from the bids endpoint); the working total is always the page's own.
  const [loaded, setLoaded] = useState({ versions: pageData.versions, pending: pageData.pending });
  useEffect(() => { setLoaded({ versions: pageData.versions, pending: pageData.pending }); }, [pageData.versions, pageData.pending]);
  const data: BidsData = { ...pageData, ...loaded };
  const [busy, setBusy] = useState(false);
  const [askSubmit, setAskSubmit] = useState(initialSubmitOpen);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);

  const versions = data.versions;
  const latest = versions[0] ?? null;
  const nextNo = (latest?.version_no ?? 0) + 1;
  const open = outcome === "open";
  const canSubmit = data.canEdit && !data.pending && open && BID_SUBMIT_STAGES.includes(stage);
  const canRevise = data.canEdit && !data.pending && open && BID_REVISE_STAGES.includes(stage);

  const [from, setFrom] = useState(String(versions[1]?.version_no ?? ""));
  const [to, setTo] = useState(String(versions[0]?.version_no ?? ""));
  const [cmp, setCmp] = useState(initialCompare);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [more, setMore] = useState<Record<string, boolean>>({});

  const { confirm } = useFeel();
  // Warn, never block: list what looks unfinished and let the person go on. The BOQ's own totals are asked for when the deal has a
  // BOQ (it knows stale prices); otherwise the saved lines tell how many have no price. A failed read just means fewer warnings.
  // The readiness line shows the same facts the dialog lists: the saved lines answer at first, the BOQ's own totals (which know stale
  // prices) replace them as soon as they are read. The line only warns.
  const [facts, setFacts] = useState<{ unpriced: number | null; stale: number | null; days: number } | null>(checks ? { unpriced: checks.unpricedFromLines, stale: null, days: checks.priceValidityDays } : null);
  const fromLines = checks?.unpricedFromLines;
  const checkDays = checks?.priceValidityDays;
  const readFacts = useCallback(async () => {
    if (fromLines === undefined || checkDays === undefined) return null;
    let next = { unpriced: fromLines as number | null, stale: null as number | null, days: checkDays };
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/boq`);
      const j = res.ok ? await res.json().catch(() => null) : null;
      if (j?.source && j.totals) {
        next = { unpriced: Number(j.totals.unpriced ?? 0), stale: Number(j.totals.stale ?? 0), days: Number(j.validity_days) > 0 ? Number(j.validity_days) : checkDays };
      }
    } catch { /* the saved lines answer for the unpriced count */ }
    setFacts(next);
    return next;
  }, [opportunityId, fromLines, checkDays]);
  useEffect(() => { void readFacts(); }, [readFacts]);

  const readiness = checks && facts ? submitWarnings({ unpriced: facts.unpriced, stale: facts.stale, priceValidityDays: facts.days, approvedGo: checks.approvedGo, guarantee: checks.guarantee }) : [];

  async function warnThen(proceed: () => void) {
    if (!checks) { proceed(); return; }
    setBusy(true);
    const read = await readFacts();
    setBusy(false);
    const warnings = read ? submitWarnings({ unpriced: read.unpriced, stale: read.stale, priceValidityDays: read.days, approvedGo: checks.approvedGo, guarantee: checks.guarantee }) : [];
    if (warnings.length > 0 && !(await confirm({ title: "Go on with this bid?", body: warnings.join("\n"), confirmLabel: "Go on" }))) return;
    proceed();
  }

  async function submit() {
    onError(""); onNotice("");
    if (nextNo > 1 && reason.trim().length < BID_LIMITS.reasonMin) { onError("Say why the bid is revised"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/bids`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision_reason: reason, note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not submit the bid"); return; }
      setAskSubmit(false); setReason(""); setNote("");
      if (j.stage_error) onError(`Version ${j.version_no} was saved, but the tender could not be moved to Submitted: ${j.stage_error}`);
      else onNotice(`Bid version ${j.version_no} submitted`);
      await reloadAfterSave<{ versions?: BidsData["versions"]; pending?: boolean }>(bidsUrl(opportunityId), (fresh) => {
        const next = mergeBids(data, fresh);
        setLoaded({ versions: next.versions, pending: next.pending });
        setFrom(String(next.versions[1]?.version_no ?? "")); setTo(String(next.versions[0]?.version_no ?? "")); setCmp(null);
      }, onChanged);
    } finally { setBusy(false); }
  }

  async function revise() {
    onError(""); onNotice("");
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "estimating", outcome: "open" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not reopen the bid"); return; }
      onNotice("Back in Estimating. Change the lines, then submit the next version");
      onChanged?.();
    } finally { setBusy(false); }
  }

  // The header's Submit bid / Revise bid opens this tab and counts startSignal up; this starts the same flow as the buttons below.
  const handledSignal = useRef(0);
  useEffect(() => {
    if (startSignal <= handledSignal.current) return;
    handledSignal.current = startSignal;
    if (canSubmit) void warnThen(() => setAskSubmit(true));
    else if (canRevise) void warnThen(revise);
    else if (data.canEdit && !data.pending && open) onError("A bid is submitted from Estimating or Clarifications");
    // Runs when the header asks, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  async function compare() {
    onError("");
    if (!from || !to || from === to) { onError("Pick two different versions"); return; }
    setCmpBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/bids/compare?from=${from}&to=${to}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not compare"); return; }
      setCmp({ from: j.from, to: j.to, diff: j.diff });
    } finally { setCmpBusy(false); }
  }

  const summary = data.pending ? "Needs a database update" : latest ? `Version ${latest.version_no} · ${fmt(latest.total)} · ${fmtStamp(latest.submitted_at)}` : "No bid submitted yet";
  const workingVsLast = latest ? data.working_total - latest.total : null;
  const vsPrevious = versions.length >= 2 ? versions[0].total - versions[1].total : null;
  const shown = showAll ? versions : versions.slice(0, SHOWN_VERSIONS);

  return (
    <div data-guide="tender.bids" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SettingsSection id="tender.bids.current" title="Bid" info={TENDER_TIPS.bidsTab} summary={summary} defaultOpen>
        {data.pending && <div role="alert" data-guide="tender.bids.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Bid versions need a database update (migration 0225). Ask your administrator to apply it.</div>}
        {checks && open && !data.pending && <ReadinessLine warnings={readiness} />}
        <StatStrip guide="tender.bids.summary">
          <StatTile tone="info" label="Lines total now" info={TENDER_TIPS.bidWorking} value={fmt(data.working_total)} sub={workingVsLast === null ? null : workingVsLast === 0 ? "same as the last version" : `${workingVsLast > 0 ? "+" : "-"}${fmt(Math.abs(workingVsLast))} since version ${latest?.version_no}`} />
          <StatTile tone="info" label="Last submitted" value={latest ? fmt(latest.total) : "—"} sub={latest ? `Version ${latest.version_no} · ${latest.line_count} line${latest.line_count === 1 ? "" : "s"}` : "Nothing submitted"} />
          <StatTile tone="context" label="Bids submitted" value={String(versions.length)} sub={latest ? `latest is version ${latest.version_no}` : "none yet"} />
          {versions.length >= 2 && <StatTile tone={toneForDelta(vsPrevious, "warn")} label="Vs previous bid" value={deltaText(vsPrevious ?? 0, null, fmt)} sub={vsPrevious === 0 ? "unchanged" : (vsPrevious ?? 0) > 0 ? "higher than version " + versions[1].version_no : "lower than version " + versions[1].version_no} />}
        </StatStrip>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {canSubmit && !askSubmit && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Button variant="primary" loading={busy} data-guide="tender.bid.submit" style={{ minHeight: 44 }} onClick={() => void warnThen(() => setAskSubmit(true))}>Submit bid</Button>
              <InfoTip label="Submit bid">{TENDER_TIPS.bidSubmit}</InfoTip>
            </span>
          )}
          {canRevise && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Button variant="secondary" loading={busy} data-guide="tender.bid.revise" style={{ minHeight: 44 }} onClick={() => void warnThen(revise)}>Revise bid</Button>
              <InfoTip label="Revise bid">{TENDER_TIPS.bidRevise}</InfoTip>
            </span>
          )}
          {!canSubmit && !canRevise && !data.pending && data.canEdit && open && (
            <span style={{ fontSize: 12.5, color: c.hint }}>A bid is submitted from Estimating or Clarifications.</span>
          )}
        </div>
        {canSubmit && askSubmit && (
          <div role="group" aria-label={`Submit version ${nextNo}`} data-guide="tender.bid.form" style={{ display: "flex", flexDirection: "column", gap: 10, border: `1px solid ${c.line}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ink }}>Submit version {nextNo} · {fmt(data.working_total)}</div>
            {nextNo > 1 && (
              <Field label="Why is the bid revised?" required info={TENDER_TIPS.bidReason} guide="tender.bid.reason">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={BID_LIMITS.reasonMax} style={{ minHeight: 64 }} />
              </Field>
            )}
            <Field label="Note" guide="tender.bid.note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={BID_LIMITS.noteMax} /></Field>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="primary" loading={busy} data-guide="tender.bid.confirm" style={{ minHeight: 44 }} onClick={submit}>Submit version {nextNo}</Button>
              <Button variant="secondary" disabled={busy} data-guide="tender.bid.cancel" style={{ minHeight: 44 }} onClick={() => setAskSubmit(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection id="tender.bids.versions" title="Versions" summary={versions.length === 0 ? "None yet" : `${versions.length} submitted`} defaultOpen={versions.length > 0}>
        {versions.length === 0 ? (
          <div style={{ fontSize: 13, color: c.hint }}>No bid has been submitted. Price the lines, then submit the first version.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((v) => (
              <div key={v.id} data-guide="tender.bid.version" style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "9px 12px", fontSize: 13 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, color: c.ink }}>Version {v.version_no}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(v.total)}</span>
                  <span style={{ fontSize: 12, color: c.hint }}>{v.line_count} line{v.line_count === 1 ? "" : "s"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: c.hint }}>{[v.submitted_by_name, fmtStamp(v.submitted_at)].filter(Boolean).join(" · ")}</span>
                </div>
                {v.revision_reason && <div style={{ marginTop: 3, color: c.muted, wordBreak: "break-word" }}>Why revised: {v.revision_reason}</div>}
                {v.note && <div style={{ marginTop: 3, color: c.muted, wordBreak: "break-word" }}>{v.note}</div>}
              </div>
            ))}
            {!showAll && versions.length > SHOWN_VERSIONS && (
              <div><Button variant="quiet" size="sm" data-guide="tender.bid.show_all" style={{ minHeight: 44 }} onClick={() => setShowAll(true)}>Show all {versions.length}</Button></div>
            )}
          </div>
        )}
      </SettingsSection>

      {versions.length >= 2 && (
        <SettingsSection id="tender.bids.compare" title="Compare versions" info={TENDER_TIPS.bidCompare} summary={cmp ? `Version ${cmp.from} to ${cmp.to}` : "Pick two versions"} defaultOpen>
          <div className="fg2">
            <Field label="From" guide="tender.bid.compare_from">
              <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                {versions.map((v) => <option key={v.id} value={v.version_no}>Version {v.version_no} · {fmt(v.total)}</option>)}
              </Select>
            </Field>
            <Field label="To" guide="tender.bid.compare_to">
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                {versions.map((v) => <option key={v.id} value={v.version_no}>Version {v.version_no} · {fmt(v.total)}</option>)}
              </Select>
            </Field>
          </div>
          <div><Button variant="secondary" loading={cmpBusy} data-guide="tender.bid.compare" style={{ minHeight: 44 }} onClick={compare}>Compare</Button></div>
          {cmp && <DiffView diff={cmp.diff} fmt={fmt} more={more} onMore={(k) => setMore((m) => ({ ...m, [k]: true }))} />}
        </SettingsSection>
      )}

      <BidDocuments opportunityId={opportunityId} versions={versions} quotes={quotes} canMakeQuote={canMakeQuote} fmt={fmt} onError={onError} onNotice={onNotice} onChanged={onChanged} />
    </div>
  );
}

/** "Before you submit" with what is still open, or a quiet "Nothing open". Warns, never blocks (the buttons stay live). */
function ReadinessLine({ warnings }: { warnings: string[] }) {
  const open = warnings.length > 0;
  const t = toneTokens(open ? "warn" : "good");
  return (
    <div role="status" data-guide="tender.bid.readiness" data-state={open ? "open" : "ready"} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", background: t.bg, color: t.ink, border: `1px solid ${t.edge}`, borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>
      <b>{open ? "Before you submit" : "Ready to submit"}</b>
      {open && <span>{warnings.join(" ")}</span>}
      {open && <InfoTip label="Before you submit">{TENDER_TIPS.submitWarnings}</InfoTip>}
    </div>
  );
}

function DiffView({ diff, fmt, more, onMore }: { diff: BidDiff; fmt: (n: number) => string; more: Record<string, boolean>; onMore: (k: string) => void }) {
  return (
    <div data-guide="tender.bid.diff" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <StatStrip>
        <StatTile tone="info" label="Total" value={fmt(diff.total_to)} sub={`was ${fmt(diff.total_from)}`} />
        <StatTile tone={toneForDelta(diff.delta, "warn")} label="Change" value={<span data-guide="tender.bid.delta" style={{ fontSize: 17 }}>{deltaText(diff.delta, diff.delta_pct, fmt)}</span>} />
        <StatTile label="Added" value={String(diff.added.length)} />
        <StatTile label="Removed" value={String(diff.removed.length)} />
        <StatTile label="Changed" value={String(diff.changed.length)} sub={`${diff.unchanged} unchanged`} />
      </StatStrip>
      <LineList id="added" title="Lines added" lines={diff.added} fmt={fmt} more={more} onMore={onMore} />
      <LineList id="removed" title="Lines removed" lines={diff.removed} fmt={fmt} more={more} onMore={onMore} />
      {diff.changed.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Lines changed</div>
          {(more.changed ? diff.changed : diff.changed.slice(0, SHOWN_LINES)).map((l) => (
            <div key={l.key} style={{ borderTop: `1px solid ${c.line}`, padding: "6px 0", fontSize: 13 }}>
              <div style={{ wordBreak: "break-word" }}><b>{l.item_no ? `${l.item_no} · ` : ""}</b>{l.after.description}</div>
              <div style={{ fontSize: 12, color: c.muted, fontVariantNumeric: "tabular-nums" }}>
                {l.fields.includes("qty") && <>Qty {l.before.qty} to {l.after.qty}. </>}
                {l.fields.includes("rate") && <>Rate {fmt(l.before.rate)} to {fmt(l.after.rate)}. </>}
                {l.fields.includes("unit") && <>Unit {l.before.unit ?? "—"} to {l.after.unit ?? "—"}. </>}
                {l.fields.includes("description") && <>Wording changed. </>}
                Amount {l.amount_delta > 0 ? "+" : l.amount_delta < 0 ? "-" : ""}{fmt(Math.abs(l.amount_delta))}
              </div>
            </div>
          ))}
          {!more.changed && diff.changed.length > SHOWN_LINES && <Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => onMore("changed")}>Show all {diff.changed.length}</Button>}
        </div>
      )}
    </div>
  );
}

function LineList({ id, title, lines, fmt, more, onMore }: { id: string; title: string; lines: BidLine[]; fmt: (n: number) => string; more: Record<string, boolean>; onMore: (k: string) => void }) {
  if (lines.length === 0) return null;
  const rows = more[id] ? lines : lines.slice(0, SHOWN_LINES);
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, marginBottom: 4 }}>{title}</div>
      {rows.map((l) => (
        <div key={l.key} style={{ borderTop: `1px solid ${c.line}`, padding: "6px 0", fontSize: 13, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 220px", wordBreak: "break-word" }}><b>{l.item_no ? `${l.item_no} · ` : ""}</b>{l.description}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", color: c.muted }}>{l.qty} {l.unit ?? ""} × {fmt(l.rate)} = {fmt(l.amount)}</span>
        </div>
      ))}
      {!more[id] && lines.length > SHOWN_LINES && <Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => onMore(id)}>Show all {lines.length}</Button>}
    </div>
  );
}
