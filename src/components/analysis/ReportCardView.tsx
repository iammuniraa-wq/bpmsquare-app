"use client";

import { useState } from "react";
import { c, statusInk } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { REPORT_TIPS } from "@/lib/analysis/report/tips";
import {
  MAX_REPORT_SEARCHES, REPORT_SECTIONS, REPORT_SECTION_LABEL, sectionCount, type CompanyReport, type ReportItem, type ReportSectionId,
} from "@/lib/analysis/report/types";
import type { DockReport, ReportSaveTarget } from "@/lib/assistant/reportTool";
import type { ConsentState, WebChoice } from "@/lib/assistant/webConsent";
import { refreshedText } from "./AnalysisCardView";

// The company report as the dock draws it (docs/design/company-report.md): a header, then collapsible sections (the overview
// open, the rest closed), every statement with the number of its source, and the numbered sources always visible. This is
// the one deliberate exception to the analysis card's "no sources on screen" rule. Every string arrives as a field and is
// drawn as a React text node, so a word from the web can never become markup, and the only links are https addresses the
// validator already checked (checked again here). Pure view: it decides nothing.

const chip: React.CSSProperties = {
  background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px",
  fontSize: 12, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit", minHeight: 44, minWidth: 44,
};
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };
const sectionBox: React.CSSProperties = { borderTop: `1px solid ${c.line}` };
const headBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 44, padding: "8px 12px", background: "none", border: "none",
  cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: c.ink, fontSize: 12.5, fontWeight: 650,
};
const body: React.CSSProperties = { padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 6 };
const list: React.CSSProperties = { margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-18" becomes "18 Oct 2026"; "2026-03" becomes "Mar 2026". Anything else is shown as it is. */
export function shortDate(on: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(on);
  if (!m) return on;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return on;
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

const isHttps = (u: string): boolean => { try { return new URL(u).protocol === "https:"; } catch { return false; } };

function Ref({ report, n }: { report: CompanyReport; n: number }) {
  const s = report.sources.find((x) => x.n === n);
  if (!s || !isHttps(s.url)) return null;
  return (
    <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${s.title}`}
      style={{ color: c.accent, fontWeight: 650, textDecoration: "none", whiteSpace: "nowrap" }}>[{n}]</a>
  );
}

function Statement({ report, item }: { report: CompanyReport; item: ReportItem }) {
  return (
    <li style={{ overflowWrap: "anywhere", color: item.old ? c.muted : c.ink }}>
      {item.text}
      {item.on ? <span style={{ color: c.hint }}>{` · ${shortDate(item.on)}${item.old ? ", older" : ""}`}</span> : null}
      {" "}<Ref report={report} n={item.src} />
    </li>
  );
}

const PROJECT_WORD: Record<string, string> = { project: "Project", client: "Client", award: "Award", tender: "Tender" };

function SectionBody({ report, id }: { report: CompanyReport; id: ReportSectionId }) {
  if (id === "leadership") {
    return (
      <ul style={list}>
        {report.leadership.map((l, i) => (
          <li key={i} style={{ overflowWrap: "anywhere", color: c.ink }}>
            <span style={{ fontWeight: 650 }}>{l.name}</span><span style={{ color: c.muted }}>{` · ${l.title}`}</span>{" "}<Ref report={report} n={l.src} />
          </li>
        ))}
      </ul>
    );
  }
  if (id === "compete") {
    return (
      <ul style={list}>
        {report.compete.map((x, i) => (
          <li key={i} style={{ overflowWrap: "anywhere", color: c.ink }}>
            <span style={{ fontWeight: 650 }}>{x.offering}</span>{`: ${x.text}`}
          </li>
        ))}
      </ul>
    );
  }
  const items = report[id] as ReportItem[];
  return (
    <ul style={list}>
      {items.map((it, i) => (
        <Statement key={i} report={report} item={id === "projects" && it.kind ? { ...it, text: `${PROJECT_WORD[it.kind] ?? "Project"}: ${it.text}` } : it} />
      ))}
    </ul>
  );
}

const SAVE_WORD: Record<ReportSaveTarget["kind"], string> = { account: "account", lead: "lead", deal: "deal", competitor: "competitor" };

export type SaveState = { state: "idle" | "saving" | "saved" | "error"; message?: string };

export default function ReportCardView({ data, busy = false, now = new Date(), onRefresh, onSave }: {
  data: DockReport;
  busy?: boolean;
  now?: Date;
  onRefresh: () => void;
  /** Saves to one target and says how it went. The dock owns the request. */
  onSave: (target: ReportSaveTarget) => Promise<{ ok: boolean; message: string }>;
}) {
  const r = data.report;
  const [open, setOpen] = useState<Set<ReportSectionId>>(() => new Set<ReportSectionId>(["overview"]));
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const toggle = (id: ReportSectionId) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const shown = REPORT_SECTIONS.filter((id) => sectionCount(r, id) > 0);
  const keyOf = (t: ReportSaveTarget) => `${t.kind}:${t.competitorId ?? t.id}`;

  async function save(t: ReportSaveTarget) {
    const k = keyOf(t);
    setSaves((p) => ({ ...p, [k]: { state: "saving" } }));
    const res = await onSave(t).catch(() => ({ ok: false, message: "Could not save just now." }));
    setSaves((p) => ({ ...p, [k]: { state: res.ok ? "saved" : "error", message: res.message } }));
  }

  return (
    <section aria-label={`Company report: ${r.name}`} data-guide="report.card"
      style={{ border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, var(--panel))", overflow: "hidden", fontSize: 12.5, lineHeight: 1.4 }}>
      <div style={{ padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ink, overflowWrap: "anywhere" }}>{r.name}</div>
          {r.summary && <div style={{ fontSize: 12, color: c.muted, overflowWrap: "anywhere" }}>{r.summary}</div>}
          <div style={{ fontSize: 11, color: c.hint, marginTop: 2, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <span>{data.cached ? "Saved" : "Made"} {refreshedText(data.computedAt || r.generatedAt, now)}</span>
            {r.searches > 0 && <span>{`· ${r.searches} ${r.searches === 1 ? "search" : "searches"}`}</span>}
            <InfoTip label="report searches">{REPORT_TIPS.searches}</InfoTip>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
          <button type="button" className="bms-dock-chip" style={chip} disabled={busy} onClick={onRefresh} data-guide="report.refresh">Refresh</button>
          <InfoTip label="refreshing a report">{REPORT_TIPS.refresh}</InfoTip>
        </div>
      </div>

      {data.notice && <div role="status" style={{ padding: "0 12px 8px", fontSize: 12, color: statusInk.warn }}>{data.notice}</div>}
      {!data.saved && <div role="status" style={{ padding: "0 12px 8px", fontSize: 12, color: statusInk.warn }}>Not saved: a database update is pending, so this report is not kept and cannot be saved to a record.</div>}

      {shown.map((id) => {
        const isOpen = open.has(id);
        const panel = `report-${id}`;
        return (
          <div key={id} style={sectionBox} data-guide={`report.section.${id}`}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button type="button" className="bms-dock-row" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(id)} style={headBtn}>
                <span aria-hidden="true" style={{ color: c.hint, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{REPORT_SECTION_LABEL[id]}</span>
                {id === "compete" && <span style={{ fontSize: 10.5, fontWeight: 700, color: statusInk.note, textTransform: "uppercase", letterSpacing: 0.4 }}>Inference</span>}
                <span style={{ color: c.hint, fontWeight: 600 }}>{sectionCount(r, id)}</span>
              </button>
              {id === "compete" && <span style={{ paddingRight: 10 }}><InfoTip label="how they compete with us">{REPORT_TIPS.inference}</InfoTip></span>}
            </div>
            {isOpen && <div id={panel} style={body}><SectionBody report={r} id={id} /></div>}
          </div>
        );
      })}

      <div style={{ ...sectionBox, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }} data-guide="report.sources">
        <div style={{ ...label, display: "flex", alignItems: "center", gap: 4 }}>Sources <InfoTip label="sources">{REPORT_TIPS.sources}</InfoTip></div>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {r.sources.filter((s) => isHttps(s.url)).map((s) => (
            <li key={s.n} style={{ overflowWrap: "anywhere", display: "flex", gap: 6 }}>
              <span style={{ color: c.hint, flexShrink: 0 }}>{`[${s.n}]`}</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, textDecoration: "none" }}>{s.title}</a>
              {s.publisher && <span style={{ color: c.hint }}>{` · ${s.publisher}`}</span>}
            </li>
          ))}
        </ol>
        {r.leftOut > 0 && (
          <div style={{ fontSize: 11.5, color: c.hint }}>{`${r.leftOut} ${r.leftOut === 1 ? "statement was" : "statements were"} left out because no page backed ${r.leftOut === 1 ? "it" : "them"}.`}</div>
        )}
      </div>

      {data.targets.length > 0 && data.saved && (
        <div style={{ ...sectionBox, padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} data-guide="report.save">
          {data.targets.map((t) => {
            const s = saves[keyOf(t)] ?? { state: "idle" as const };
            return (
              <span key={keyOf(t)} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                <button type="button" className="bms-dock-chip" style={chip} disabled={busy || s.state === "saving" || s.state === "saved"} onClick={() => void save(t)}>
                  {s.state === "saving" ? "Saving…" : s.state === "saved" ? `Saved to ${SAVE_WORD[t.kind]}` : `Save to ${SAVE_WORD[t.kind]}`}
                </button>
                {s.state === "error" && s.message && <span role="alert" style={{ fontSize: 11.5, color: statusInk.bad }}>{s.message}</span>}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

const cardBox: React.CSSProperties = {
  border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, var(--panel))", padding: "10px 12px",
  display: "flex", flexDirection: "column", gap: 8,
};

const SETTLED: Record<Exclude<ConsentState, "pending">, string> = {
  yes: "Researched with web research",
  no: "Not researched",
  skipped: "Not researched",
};

/** "Research this company on the web?" with Yes / No and the number of searches behind its "i". Once answered it shrinks to one muted line. */
export function ReportConsentRow({ subject, searches = MAX_REPORT_SEARCHES, state, disabled, onChoice }: {
  subject: string;
  searches?: number;
  state: ConsentState;
  disabled?: boolean;
  onChoice: (choice: WebChoice) => void;
}) {
  if (state !== "pending") return <div style={{ fontSize: 11.5, color: c.hint }}>{SETTLED[state]}</div>;
  return (
    <div style={cardBox} role="group" aria-label="Research with web research?" data-guide="report.consent">
      <div style={{ ...label, display: "flex", alignItems: "center", gap: 4 }}>Research on the web? <InfoTip label="report searches">{REPORT_TIPS.searches}</InfoTip></div>
      <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.4, overflowWrap: "anywhere" }}>{subject}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("yes")} data-guide="report.consent.yes">Yes</button>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("no")} data-guide="report.consent.no">No</button>
        <span style={{ fontSize: 11.5, color: c.hint }}>{`Up to ${searches} searches`}</span>
      </div>
    </div>
  );
}
