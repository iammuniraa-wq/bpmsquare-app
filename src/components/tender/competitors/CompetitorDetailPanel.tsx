"use client";

import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import StatusPill from "@/components/ui/StatusPill";
import AnalysisCardView from "@/components/analysis/AnalysisCardView";
import { TONE_PILLAR } from "@/lib/ui/tone";
import { COMPETITOR_PRICE_LABEL, priceGap, sourceHost, type CompetitorsData, type CompetitorView } from "@/lib/tender/competitors/rules";
import { COMPETITOR_TIPS } from "@/lib/tender/competitors/tips";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";

// One competitor opened from the list: what the team knows (website, country, expected price, strengths, note), what market research found
// with the page behind every fact, a win against us and their likely price when a page states them ("not found" otherwise, never a guess),
// the Company insights card, and the actions. A proposal can only be accepted or rejected; the team's own competitor can be edited, marked
// as the winner or removed. The shared SidePanel: a side panel on a desktop, a bottom sheet under 780 px.

export type InsightState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; analysis: DockAnalysis; open: boolean };

const LABEL: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };
const TEXT: React.CSSProperties = { fontSize: 13, color: c.ink, overflowWrap: "anywhere", whiteSpace: "pre-wrap" };
const NOT_FOUND = <span style={{ color: c.hint }}>not found</span>;

const money = (n: number, currency: string | null) => `${currency ?? ""} ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`.trim();

function Row({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ ...LABEL, display: "flex", alignItems: "center", gap: 4 }}>{label}{info && <InfoTip label={label}>{info}</InfoTip>}</div>
      <div style={TEXT}>{children}</div>
    </div>
  );
}

function Source({ url, title }: { url: string; title?: string | null }) {
  if (!url.startsWith("https://")) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, textDecoration: "none", whiteSpace: "normal" }}>source: {title || sourceHost(url)}</a>;
}

export default function CompetitorDetailPanel({ competitor: x, canEdit, ourBid, insightsAvailable, insight, busy, onClose, onAccept, onReject, onEdit, onToggleWinner, onRemove, onInsights, onToggleInsights, onOpen, onAsk }: {
  competitor: CompetitorView;
  canEdit: boolean;
  ourBid?: CompetitorsData["our_bid"];
  insightsAvailable: boolean;
  insight?: InsightState;
  busy?: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onToggleWinner: () => void;
  onRemove: () => void;
  onInsights: (refresh: boolean) => void;
  onToggleInsights: () => void;
  onOpen: (href: string) => void;
  onAsk: (question: string) => void;
}) {
  const site = x.website && x.website.startsWith("https://") ? x.website : null;
  const ev = x.evidence;
  const proposed = x.status === "proposed";
  const done = insight?.status === "done" ? insight : null;
  const gap = ev?.price?.amount != null && ourBid ? priceGap(ev.price.amount, ourBid.total) : null;

  const footer = canEdit ? (
    proposed ? (
      <div className="bpm-tap" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" loading={busy} data-guide="competitor.accept" style={{ minHeight: 44 }} onClick={onAccept}>Accept</Button>
        <Button variant="secondary" disabled={busy} data-guide="competitor.reject" style={{ minHeight: 44 }} onClick={onReject}>Reject</Button>
      </div>
    ) : (
      <div className="bpm-tap" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" data-guide="competitor.edit" style={{ minHeight: 44 }} onClick={onEdit}>Edit</Button>
        <Button variant="secondary" data-guide="competitor.winner" style={{ minHeight: 44 }} onClick={onToggleWinner}>{x.is_winner ? "Unmark winner" : "Mark as winner"}</Button>
        <Button variant="quiet" data-guide="competitor.remove" style={{ minHeight: 44 }} onClick={onRemove}>Remove</Button>
      </div>
    )
  ) : undefined;

  return (
    <SidePanel title={x.name} label={`Competitor ${x.name}`} onClose={onClose} footer={footer}
      subtitle={<span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        <StatusPill label={proposed ? "Proposed" : "Added by you"} tone={proposed ? "blue" : TONE_PILLAR.good} />
        {x.is_winner && <StatusPill label="Won this tender" tone={TONE_PILLAR.bad} />}
      </span>}
    >
      <div data-guide="competitor.detail" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Row label="Website">{site ? <a href={site} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, textDecoration: "none" }}>{site.replace(/^https:\/\//, "")}</a> : <span style={{ color: c.hint }}>not set</span>}</Row>
        <Row label="Country">{x.country ?? <span style={{ color: c.hint }}>not set</span>}</Row>
        <Row label="Expected price" info={COMPETITOR_TIPS.expectedPrice}>{x.expected_price ? COMPETITOR_PRICE_LABEL[x.expected_price] : <span style={{ color: c.hint }}>Unknown</span>}</Row>
        <Row label="Strengths">{x.strengths ?? <span style={{ color: c.hint }}>not set</span>}</Row>
        <Row label="Notes">{x.notes ?? <span style={{ color: c.hint }}>not set</span>}</Row>

        <div data-guide="competitor.evidence" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
          <div style={{ ...LABEL, display: "flex", alignItems: "center", gap: 4 }}>Evidence<InfoTip label="Evidence">{COMPETITOR_TIPS.evidence}</InfoTip></div>
          {ev && ev.facts.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {ev.facts.map((f, i) => (
                <li key={i} style={TEXT}>
                  {f.text}{f.published_on ? <span style={{ color: c.hint }}> ({f.published_on})</span> : null} <Source url={f.source_url} title={f.source_title} />
                </li>
              ))}
            </ul>
          ) : (
            <div style={TEXT}>{NOT_FOUND}</div>
          )}
          <Row label="Won against us">{ev?.wins ? <>{ev.wins.text} <Source url={ev.wins.source_url} /></> : NOT_FOUND}</Row>
          <Row label="Their likely price">
            {ev?.price ? (
              <>
                {ev.price.text} <Source url={ev.price.source_url} />
                {gap && ourBid ? <div style={{ color: c.muted, marginTop: 2 }}>our bid {money(ourBid.total, ourBid.currency)} (v{ourBid.version_no}) · theirs is {gap.label} against ours</div> : null}
              </>
            ) : NOT_FOUND}
          </Row>
        </div>

        {insightsAvailable && (
          <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="bpm-tap" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Button variant="secondary" size="sm" loading={insight?.status === "loading"} data-guide="competitor.insights" style={{ minHeight: 44 }}
                onClick={() => (done ? onToggleInsights() : onInsights(false))}>
                {insight?.status === "loading" ? "Analysing…" : done ? (done.open ? "Hide insights" : "Show insights") : "Company insights"}
              </Button>
              <InfoTip label="Company insights">{COMPETITOR_TIPS.insights}</InfoTip>
            </div>
            {insight?.status === "error" && <div role="alert" data-guide="competitor.insights.error" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{insight.message}</div>}
            {done?.open && <AnalysisCardView data={done.analysis} onOpen={onOpen} onRefresh={() => onInsights(true)} onAsk={onAsk} />}
          </div>
        )}
      </div>
    </SidePanel>
  );
}
