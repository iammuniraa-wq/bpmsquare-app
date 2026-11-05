"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import { CREW_TIPS } from "@/lib/crew/tips";
import s from "./crew.module.css";
import When from "./When";

// The run trace (design section 3.6, a first-class screen): header, then four sections that remember whether they are open: Looked at, Concluded,
// Proposed, Could not check / left out. A Raw toggle (admins) shows the stored step JSON. The page shows only data already minimised at the adapter.

export type TraceStep = { seq: number; kind: string; name: string; id: string | null; ok: boolean; error: string | null; ms: number; tokensIn: number; tokensOut: number; refs: { type: string; id: string; label: string; href: string | null }[]; input: unknown; output: unknown };
export type TraceData = {
  agent: string; agentName: string; accent: string; trigger: string; because: string; status: string; model: string | null; promptVersion: string | null;
  queuedAt: string; startedAt: string | null; finishedAt: string | null; tokensIn: number; tokensOut: number; percentOfCap: number; error: string | null; note: string | null;
  steps: TraceStep[];
  concluded: { title: string; severity: string; evidence: string[] }[];
  proposed: { text: string; status: string; to: string[] }[];
  left: string[];
  isAdmin: boolean;
};

const KEY = "bpm.crew.trace.open";

function useRemembered(id: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    try { const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>; if (typeof raw[id] === "boolean") setOpen(raw[id]); } catch { /* remembered state is a convenience */ }
  }, [id]);
  const toggle = () => setOpen((v) => {
    try { const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>; window.localStorage.setItem(KEY, JSON.stringify({ ...raw, [id]: !v })); } catch { /* ignore */ }
    return !v;
  });
  return [open, toggle];
}

function Section({ id, title, count, children, initial = true }: { id: string; title: string; count?: number; children: React.ReactNode; initial?: boolean }) {
  const [open, toggle] = useRemembered(id, initial);
  return (
    <section className={s.acc} data-guide={`crew.trace.${id}`}>
      <button type="button" className={s.accHead} aria-expanded={open} onClick={toggle}><span>{title}{typeof count === "number" ? ` (${count})` : ""}</span><span aria-hidden>{open ? "−" : "+"}</span></button>
      {open && <div className={s.accBody}>{children}</div>}
    </section>
  );
}

export default function TraceView({ t }: { t: TraceData }) {
  const [raw, setRaw] = useState(false);
  const looked = t.steps.filter((x) => x.kind === "prefetch" || x.kind === "tool");
  return (
    <div className={`${s.trace} ${s[`acc_${t.accent}`]}`}>
      <Link href={ROUTES.aiAutomationAgent(t.agent)} className={s.back}>← {t.agentName}</Link>
      <div className={s.sum} data-guide="crew.trace.header">
        <div className={s.sumItem}><div className={s.statLabel}>Because</div><div className={s.statValue}>{t.because || t.trigger}</div></div>
        <div className={s.sumItem}><div className={s.statLabel}>Status</div><div className={s.statValue}>{t.status.replace("_", " ")}</div></div>
        <div className={s.sumItem}><div className={s.statLabel}>Started</div><div className={s.statValue}><When iso={t.startedAt ?? t.queuedAt} mode="stamp" /></div></div>
        <div className={s.sumItem}><div className={s.statLabel}>Tokens in / out <InfoTip label="Tokens">{CREW_TIPS.tokens}</InfoTip></div><div className={s.statValue}>{t.tokensIn.toLocaleString("en-GB")} / {t.tokensOut.toLocaleString("en-GB")}</div></div>
        <div className={s.sumItem}><div className={s.statLabel}>Share of cap</div><div className={s.statValue}>{t.percentOfCap}%</div></div>
        {t.model && <div className={s.sumItem}><div className={s.statLabel}>Model</div><div className={s.statValue}>{t.model}</div></div>}
      </div>
      <div className={s.headNote}><InfoTip label="Trace">{CREW_TIPS.trace}</InfoTip> {t.error ? <span style={{ color: "var(--redink)" }}>{t.error}</span> : t.note}</div>

      <Section id="looked" title="Looked at" count={looked.length}>
        {looked.length === 0 && <div className={s.headNote}>Nothing was read: this was a quiet pass.</div>}
        {looked.map((x) => (
          <div key={x.seq} className={s.step}>
            <div className={s.stepName}>{x.id && <span className={s.stepId}>{x.id}</span>}{x.name}{!x.ok && <span style={{ color: "var(--redink)" }}>could not be read: {x.error}</span>}</div>
            {x.refs.length > 0 && <div style={{ marginTop: 4 }}>{x.refs.slice(0, 12).map((r, i) => (r.href ? <Link key={i} href={r.href} className={s.refLink}>{r.label}</Link> : <span key={i} className={s.refLink}>{r.label}</span>))}</div>}
            {raw && t.isAdmin && <pre className={s.raw}>{JSON.stringify({ input: x.input, output: x.output }, null, 2)}</pre>}
          </div>
        ))}
        {t.isAdmin && looked.length > 0 && <button type="button" className={s.whyBtn} onClick={() => setRaw((v) => !v)}>{raw ? "Hide raw" : "Raw"}</button>}
      </Section>

      <Section id="concluded" title="Concluded" count={t.concluded.length}>
        {t.concluded.length === 0 && <div className={s.headNote}>No suggestions came out of this run.</div>}
        {t.concluded.map((c, i) => <div key={i} className={s.step}><div className={s.stepName}>{c.title}</div><div className={s.headNote}>{c.evidence.join(" · ")}</div></div>)}
      </Section>

      <Section id="proposed" title="Proposed" count={t.proposed.length} initial={false}>
        {t.proposed.length === 0 && <div className={s.headNote}>No note was drafted.</div>}
        {t.proposed.map((p, i) => <div key={i} className={s.step}><div className={s.stepName}>{p.status} · to {p.to.join(", ") || "a colleague"}</div><div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{p.text}</div></div>)}
      </Section>

      <Section id="left" title="Could not check / left out" count={t.left.length} initial={false}>
        {t.left.length === 0 && <div className={s.headNote}>Nothing was left out.</div>}
        {t.left.map((l, i) => <div key={i} className={s.step}>{l}</div>)}
      </Section>
    </div>
  );
}
