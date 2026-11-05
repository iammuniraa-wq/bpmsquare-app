"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import { agentEntry } from "@/lib/crew/registry";
import { CREW_TIPS } from "@/lib/crew/tips";
import type { FindingDTO, ProposalDTO } from "@/lib/crew/viewTypes";
import s from "./crew.module.css";
import When from "./When";

// The Review list (design section 6): open suggestions, most urgent first. Title, a severity chip, one small visual, and the reasoning behind
// "Why" (collapsed). A note the agent drafted opens an editor: Edit and send is the default button, there is no one-tap send for text that reaches
// a colleague or an employee. Dismiss is "not now"; Not an issue silences the same situation for 30 days. Five shown, then Show all.
// An attendance suggestion reads as a "Review suggestion" with three fixed parts (what was observed, what else could explain it, what you could do)
// and a strip of dots, one per shift-day, instead of the tender bar and ring.

const SHOWN = 5;
const SEV_LABEL = { urgent: "Review soon", review: "Worth a look", info: "Note" } as const;
const SEV_LABEL_ATTENDANCE = { urgent: "Review soon", review: "Worth a look", info: "For information" } as const;
const RANK = { urgent: 0, review: 1, info: 2 } as const;
const PARTS = ["What was observed", "What else could explain it", "What you could do", "Note for the site team"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shortDay = (iso: string): string => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso); return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ""}`.trim() : iso; };

/** The body of an attendance finding is stored as labelled lines; anything else is shown as one paragraph. */
export function bodyParts(body: string): { label: string | null; text: string }[] {
  const out: { label: string | null; text: string }[] = [];
  for (const line of body.split("\n")) {
    const label = PARTS.find((p) => line.startsWith(`${p}:`));
    if (label) out.push({ label, text: line.slice(label.length + 1).trim() });
    else if (line.trim()) out.push({ label: null, text: line.trim() });
  }
  return out;
}

export default function ReviewList({ findings, proposals, empty, showAgent }: { findings: FindingDTO[]; proposals: ProposalDTO[]; empty: { title: string; text?: string }; showAgent: boolean }) {
  const [all, setAll] = useState(false);
  const sorted = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const shown = all ? sorted : sorted.slice(0, SHOWN);
  if (sorted.length === 0) {
    return (
      <div className={s.empty} data-guide="crew.review.empty">
        <div className={s.emptyTitle}>{empty.title}</div>
        {empty.text && <div style={{ marginTop: 6, fontSize: 13 }}>{empty.text}</div>}
      </div>
    );
  }
  return (
    <div>
      <div className={s.list}>
        {shown.map((f) => <FindingCard key={f.id} f={f} p={proposals.find((x) => x.findingId === f.id) ?? null} showAgent={showAgent} />)}
      </div>
      {sorted.length > SHOWN && (
        <div className={s.more}><button type="button" className={s.btn} onClick={() => setAll((v) => !v)} data-guide="crew.review.show_all">{all ? "Show fewer" : `Show all (${sorted.length})`}</button></div>
      )}
    </div>
  );
}

/** One dot per shift-day. Filled = a day the pattern is made of; pale = other notes that day; dashed = nobody was expected. */
function SiteStrip({ strip }: { strip: NonNullable<FindingDTO["strip"]> }) {
  const n = strip.dates.length;
  if (n === 0) return null;
  const days = strip.marked.filter(Boolean).length;
  return (
    <div className={s.strip} role="img" aria-label={`${n} shift-days from ${shortDay(strip.dates[0])} to ${shortDay(strip.dates[n - 1])}; the pattern is on ${days} of them`} data-guide="crew.finding.strip">
      {strip.dates.map((d, i) => {
        const tone = strip.marked[i] ? s.stripOn : (strip.flagged[i] ?? 0) > 0 ? s.stripFlag : (strip.rostered[i] ?? 0) === 0 ? s.stripNone : "";
        return <span key={d} className={`${s.stripDot} ${tone}`} title={`${shortDay(d)}: ${strip.present[i] ?? 0} of ${strip.rostered[i] ?? 0} present`} />;
      })}
      <span className={s.stripCaption}>{shortDay(strip.dates[0])} to {shortDay(strip.dates[n - 1])} <InfoTip label="Shift-day dots">{CREW_TIPS.strip}</InfoTip></span>
    </div>
  );
}

function FindingCard({ f, p, showAgent }: { f: FindingDTO; p: ProposalDTO | null; showAgent: boolean }) {
  const router = useRouter();
  const entry = agentEntry(f.agent);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p?.message ?? "");
  const [picked, setPicked] = useState<string[]>(p?.targets.map((t) => t.id) ?? []);
  const v = f.visual;
  const attendance = f.agent === "attendance";
  const recheck = p?.actionKey === "wfm.recheck";
  const sev = attendance ? SEV_LABEL_ATTENDANCE : SEV_LABEL;

  async function call(url: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true); setErr("");
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "That did not work."); return false; }
      router.refresh();
      return true;
    } finally { setBusy(false); }
  }

  const togglePick = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const sendBody = { action: "approve", message: text, ...(recheck ? { targets: picked } : {}) };

  return (
    <article className={`${s.card} ${s[`sev_${f.severity}`]} ${entry ? s[`acc_${entry.accent}`] : ""}`} data-guide={`crew.finding.${f.id}`}>
      <div className={s.cardHead}>
        <span className={s.sevChip}>{sev[f.severity]}</span>
        {attendance && <span className={s.tag}>Review suggestion <InfoTip label="Review suggestion">{CREW_TIPS.reviewSuggestion}</InfoTip></span>}
        <h4 className={s.cardTitle}>{f.title}</h4>
        <span className={s.ringLabel}><When iso={f.createdAt} /></span>
      </div>
      {showAgent && entry && <div className={s.ringLabel} style={{ marginTop: 4 }}>{entry.name}</div>}

      {v && (v.pricedPct !== null || v.daysLeft !== null) && (
        <div className={s.visual}>
          {v.pricedPct !== null && (
            <div className={s.bar}>
              <div className={s.barTrack} role="img" aria-label={`${v.pricedPct}% of lines priced`}><span className={s.barFill} style={{ width: `${v.pricedPct}%` }} /></div>
              <div className={s.barLabel}>{v.lines !== null && v.unpriced !== null ? `${v.lines - v.unpriced} of ${v.lines} lines priced` : `${v.pricedPct}% priced`}</div>
            </div>
          )}
          {v.daysLeft !== null && (
            <div style={{ textAlign: "center" }}>
              <div className={s.ring} style={{ ["--ringp" as string]: Math.max(0, Math.min(100, 100 - (v.daysLeft / 21) * 100)), ["--ringc" as string]: v.daysLeft <= 3 ? "var(--red)" : "var(--amberc)" }} role="img" aria-label={`${v.daysLeft} days left`}><span>{Math.max(0, v.daysLeft)}</span></div>
              <div className={s.ringLabel}>days left</div>
            </div>
          )}
        </div>
      )}
      {f.strip && <SiteStrip strip={f.strip} />}

      {attendance ? (
        <div className={s.parts}>
          {bodyParts(f.body).map((x, i) => (
            <p key={i} className={s.part}>{x.label && <span className={s.partLabel}>{x.label}</span>}{x.text}</p>
          ))}
        </div>
      ) : (
        <p className={s.cardBody}>{f.body}</p>
      )}

      <div className={s.why}>
        <button type="button" className={s.whyBtn} aria-expanded={why} onClick={() => setWhy((x) => !x)} data-guide="crew.finding.why">{why ? "Hide why" : "Why"}</button>
        <InfoTip label="Why">{CREW_TIPS.why}</InfoTip>
        {why && (
          <>
            <div className={s.chips}>
              {f.evidence.map((e, i) => e.href
                ? <Link key={i} href={e.href} className={s.evidence}>{e.label}</Link>
                : <span key={i} className={s.evidence}>{e.label}</span>)}
              {f.runId && <Link href={`/ai-automation/${f.agent}/runs/${f.runId}`} className={s.evidence}>See the run</Link>}
            </div>
            {f.gaps.length > 0 && <ul className={s.gaps}>{f.gaps.map((g, i) => <li key={i}>Could not check: {g}</li>)}</ul>}
          </>
        )}
      </div>

      {p && p.canDecide && (
        <div className={s.proposal}>
          <div className={s.proposalHead}>{recheck ? "Ask for a recheck" : "Suggested note"} <InfoTip label={recheck ? "Ask for a recheck" : "Suggested note"}>{recheck ? CREW_TIPS.recheck : CREW_TIPS.editSend}</InfoTip></div>
          {recheck && p.targets.length > 1 ? (
            <ul className={s.targets} aria-label="People to ask" data-guide="crew.proposal.targets">
              {p.targets.map((t) => (
                <li key={t.id}><label className={s.targetRow}><input type="checkbox" checked={picked.includes(t.id)} onChange={() => togglePick(t.id)} disabled={busy} />{t.name}</label></li>
              ))}
            </ul>
          ) : (
            <div className={s.to}>To: {p.toNames.join(", ") || "a colleague"}</div>
          )}
          {editing
            ? <textarea className={s.proposalText} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} aria-label="Note to send" data-guide="crew.proposal.text" />
            : <p className={s.cardBody} style={{ whiteSpace: "pre-wrap" }}>{p.message}</p>}
          <div className={s.actions}>
            {editing
              ? <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || text.trim().length < 2 || (recheck && picked.length === 0)} onClick={() => call(`/api/crew/proposals/${p.id}/decide`, "POST", sendBody)} data-guide="crew.proposal.send">Send</button>
              : <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={() => setEditing(true)} data-guide="crew.proposal.edit">Edit and send</button>}
            <button type="button" className={s.btn} disabled={busy} onClick={() => call(`/api/crew/proposals/${p.id}/decide`, "POST", { action: "reject" })} data-guide="crew.proposal.reject">Reject</button>
          </div>
        </div>
      )}

      {err && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "var(--redink)" }}>{err}</div>}

      <div className={s.actions}>
        {f.href && <Link href={f.href} className={s.btn}>{attendance ? (f.href === ROUTES.wfmLiveBoard ? "Open live board" : "Open employee") : "Open tender"}</Link>}
        <button type="button" className={s.btn} disabled={busy} onClick={() => call(`/api/crew/findings/${f.id}`, "PATCH", { status: "dismissed" })} data-guide="crew.finding.dismiss">Dismiss</button>
        <button type="button" className={s.btn} disabled={busy} onClick={() => call(`/api/crew/findings/${f.id}`, "PATCH", { status: "not_an_issue" })} data-guide="crew.finding.not_an_issue">Not an issue</button>
        <InfoTip label="Not an issue">{CREW_TIPS.notAnIssue}</InfoTip>
      </div>
    </article>
  );
}
