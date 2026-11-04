"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import { agentEntry } from "@/lib/crew/registry";
import { CREW_TIPS } from "@/lib/crew/tips";
import type { FindingDTO, ProposalDTO } from "@/lib/crew/viewTypes";
import s from "./crew.module.css";
import When from "./When";

// The Review list (design section 6): open suggestions, most urgent first. Title, a severity chip, one small visual, and the reasoning behind
// "Why" (collapsed). A note the agent drafted opens an editor: Edit and send is the default button, there is no one-tap send for text that reaches
// a colleague. Dismiss is "not now"; Not an issue silences the same situation for 30 days. Five shown, then Show all.

const SHOWN = 5;
const SEV_LABEL = { urgent: "Review soon", review: "Worth a look", info: "Note" } as const;
const RANK = { urgent: 0, review: 1, info: 2 } as const;

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

function FindingCard({ f, p, showAgent }: { f: FindingDTO; p: ProposalDTO | null; showAgent: boolean }) {
  const router = useRouter();
  const entry = agentEntry(f.agent);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p?.message ?? "");
  const v = f.visual;

  async function call(url: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true); setErr("");
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "That did not work."); return false; }
      router.refresh();
      return true;
    } finally { setBusy(false); }
  }

  return (
    <article className={`${s.card} ${s[`sev_${f.severity}`]} ${entry ? s[`acc_${entry.accent}`] : ""}`} data-guide={`crew.finding.${f.id}`}>
      <div className={s.cardHead}>
        <span className={s.sevChip}>{SEV_LABEL[f.severity]}</span>
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

      <p className={s.cardBody}>{f.body}</p>

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
          <div className={s.proposalHead}>Suggested note <InfoTip label="Suggested note">{CREW_TIPS.editSend}</InfoTip></div>
          <div className={s.to}>To: {p.toNames.join(", ") || "a colleague"}</div>
          {editing
            ? <textarea className={s.proposalText} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} aria-label="Note to send" data-guide="crew.proposal.text" />
            : <p className={s.cardBody} style={{ whiteSpace: "pre-wrap" }}>{p.message}</p>}
          <div className={s.actions}>
            {editing
              ? <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || text.trim().length < 2} onClick={() => call(`/api/crew/proposals/${p.id}/decide`, "POST", { action: "approve", message: text })} data-guide="crew.proposal.send">Send</button>
              : <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={() => setEditing(true)} data-guide="crew.proposal.edit">Edit and send</button>}
            <button type="button" className={s.btn} disabled={busy} onClick={() => call(`/api/crew/proposals/${p.id}/decide`, "POST", { action: "reject" })} data-guide="crew.proposal.reject">Reject</button>
          </div>
        </div>
      )}

      {err && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "var(--redink)" }}>{err}</div>}

      <div className={s.actions}>
        {f.href && <Link href={f.href} className={s.btn}>Open tender</Link>}
        <button type="button" className={s.btn} disabled={busy} onClick={() => call(`/api/crew/findings/${f.id}`, "PATCH", { status: "dismissed" })} data-guide="crew.finding.dismiss">Dismiss</button>
        <button type="button" className={s.btn} disabled={busy} onClick={() => call(`/api/crew/findings/${f.id}`, "PATCH", { status: "not_an_issue" })} data-guide="crew.finding.not_an_issue">Not an issue</button>
        <InfoTip label="Not an issue">{CREW_TIPS.notAnIssue}</InfoTip>
      </div>
    </article>
  );
}
