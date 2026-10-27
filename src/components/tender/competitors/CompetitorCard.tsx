"use client";

import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import MoreMenu from "@/components/ui/MoreMenu";
import StatusPill from "@/components/ui/StatusPill";
import AnalysisCardView from "@/components/analysis/AnalysisCardView";
import { TONE_PILLAR, toneTokens, type Tone } from "@/lib/ui/tone";
import { COMPETITOR_PRICE_LABEL, type CompetitorPrice, type CompetitorView } from "@/lib/tender/competitors/rules";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";

// One competitor as a card: name, website and country, the expected price position, strengths and note, the winner marker, and the
// Company insights button with the analysis card it opens. All text is drawn as text. Actions that change the record are for people who
// may edit the deal; the "more" menu (the winner mark, remove) and the buttons are 44 px on a phone through .bpm-tap.

export type InsightState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; analysis: DockAnalysis; open: boolean };

/** Read from our side: a competitor expected below us is the one to watch (amber), above us is comfortable. */
const PRICE_TONE: Record<CompetitorPrice, Exclude<Tone, "neutral">> = { lower: "warn", similar: "info", higher: "good" };

const TEXT: React.CSSProperties = { fontSize: 13, color: c.ink, overflowWrap: "anywhere", whiteSpace: "pre-wrap" };
const LABEL: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };

export default function CompetitorCard({ competitor: x, canEdit, insightsAvailable, insight, onInsights, onToggleInsights, onEdit, onToggleWinner, onRemove, onOpen, onAsk }: {
  competitor: CompetitorView;
  canEdit: boolean;
  insightsAvailable: boolean;
  insight?: InsightState;
  onInsights: (refresh: boolean) => void;
  onToggleInsights: () => void;
  onEdit: () => void;
  onToggleWinner: () => void;
  onRemove: () => void;
  onOpen: (href: string) => void;
  onAsk: (question: string) => void;
}) {
  const site = x.website && x.website.startsWith("https://") ? x.website : null;
  const meta = [x.country].filter(Boolean).join(" · ");
  const done = insight?.status === "done" ? insight : null;
  return (
    <div data-guide="competitor.card" data-competitor={x.id}>
      <Card padding={14} style={{ height: "100%", ...(x.is_winner ? { borderLeft: `3px solid ${toneTokens("bad").edge}` } : null) }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink, overflowWrap: "anywhere" }}>{x.name}</div>
              {(site || meta) && (
                <div style={{ fontSize: 12.5, color: c.muted, overflowWrap: "anywhere" }}>
                  {site && <a href={site} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, textDecoration: "none" }}>{site.replace(/^https:\/\//, "")}</a>}
                  {site && meta ? " · " : ""}{meta}
                </div>
              )}
            </div>
            {canEdit && (
              <MoreMenu label={`More for ${x.name}`} items={[
                { label: x.is_winner ? "Remove winner mark" : "Mark as winner", onSelect: onToggleWinner },
                { label: "Remove", danger: true, onSelect: onRemove },
              ]} />
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {x.is_winner && <StatusPill label="Won this tender" tone={TONE_PILLAR.bad} />}
            {x.expected_price && <StatusPill label={`Expected price: ${COMPETITOR_PRICE_LABEL[x.expected_price]}`} tone={TONE_PILLAR[PRICE_TONE[x.expected_price]]} />}
          </div>

          {x.strengths && <div><div style={LABEL}>Strengths</div><div style={TEXT}>{x.strengths}</div></div>}
          {x.notes && <div><div style={LABEL}>Note</div><div style={TEXT}>{x.notes}</div></div>}

          <div className="bpm-tap" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {insightsAvailable && (
              <Button
                variant="secondary" size="sm" loading={insight?.status === "loading"} data-guide="competitor.insights" style={{ minHeight: 44 }}
                onClick={() => (done ? onToggleInsights() : onInsights(false))}
              >
                {insight?.status === "loading" ? "Analysing…" : done ? (done.open ? "Hide insights" : "Show insights") : "Company insights"}
              </Button>
            )}
            {canEdit && <Button variant="quiet" size="sm" data-guide="competitor.edit" style={{ minHeight: 44 }} onClick={onEdit}>Edit</Button>}
          </div>

          {insight?.status === "error" && <div role="alert" data-guide="competitor.insights.error" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{insight.message}</div>}
          {done?.open && (
            <AnalysisCardView data={done.analysis} onOpen={onOpen} onRefresh={() => onInsights(true)} onAsk={onAsk} />
          )}
        </div>
      </Card>
    </div>
  );
}
