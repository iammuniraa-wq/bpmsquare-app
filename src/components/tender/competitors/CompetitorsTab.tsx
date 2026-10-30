"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { useFeel } from "@/components/FeelProvider";
import { askDock } from "@/lib/analysis/dockAsk";
import { TONE_PILLAR } from "@/lib/ui/tone";
import { COMPETITOR_LIMITS, COMPETITOR_PRICE_LABEL, competitorStats, type CompetitorView, type CompetitorsData } from "@/lib/tender/competitors/rules";
import { COMPETITOR_TIPS } from "@/lib/tender/competitors/tips";
import { assumesLine, type PartialAnswers, type Question } from "@/lib/tender/competitors/researchRules";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";
import CompetitorDetailPanel, { type InsightState } from "./CompetitorDetailPanel";
import CompetitorPanel from "./CompetitorPanel";
import ResearchQuestions from "./ResearchQuestions";

// The Competitors tab of a tender deal (migration 0229, 0239): who we expect to bid against. One line of figures, then one list that shows
// only Company, Expected price and Status (Proposed by market research, or Added by you); a row opens the detail panel with the evidence
// and the actions. Under 780 px each row becomes a card, so nothing scrolls sideways. Company insights run only when pressed (they cost AI
// allowance). Edit access comes from the deal; the server decides again on every call.

const PENDING = "Competitors need a database update (migration 0229). Ask your administrator to apply it.";
const PENDING_RESEARCH = "Market research needs a database update (migration 0239). Ask your administrator to apply it.";

const css = `
.cmp-table{width:100%;border-collapse:collapse}
.cmp-table th{text-align:left;font-size:10.5px;font-weight:700;color:var(--hint);text-transform:uppercase;letter-spacing:.4px;padding:6px 8px}
.cmp-table td{padding:6px 8px;border-top:1px solid var(--line);vertical-align:middle}
.cmp-row{cursor:pointer}
.cmp-row:hover{background:var(--panel2)}
.cmp-open{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;font-size:14px;color:var(--ink);overflow-wrap:anywhere}
.cmp-open:focus-visible{outline:2px solid var(--tenant-accent);outline-offset:2px}
.cmp-chev{color:var(--hint);width:24px;text-align:right}
@media (max-width:780px){
  .cmp-table thead{display:none}
  .cmp-table,.cmp-table tbody{display:block}
  .cmp-table tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:6px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;align-items:center}
  .cmp-table td{display:block;padding:0;border:0}
  .cmp-table td.cmp-name{grid-column:1}
  .cmp-table td.cmp-status{grid-column:2;grid-row:1}
  .cmp-table td.cmp-price{grid-column:1 / -1;padding-bottom:6px}
  .cmp-chev{display:none}
}
`;

export default function CompetitorsTab({ opportunityId, canEdit, onError, onNotice, onChanged, initialData, initialPanel = false, initialOpen = null }: {
  opportunityId: string;
  canEdit: boolean;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
  /** Called after a change that the rest of the page shows too (the winner is the deal's competitor). */
  onChanged?: () => void;
  /** Lets a server render (and its test) show the tab with its list. The page never passes it. */
  initialData?: CompetitorsData;
  initialPanel?: boolean;
  /** Lets a server render show a competitor's detail panel. The page never passes it. */
  initialOpen?: string | null;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [data, setData] = useState<CompetitorsData | null>(initialData ?? null);
  const [loadError, setLoadError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [panel, setPanel] = useState<{ competitor?: CompetitorView } | null>(initialPanel ? {} : null);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [insights, setInsights] = useState<Record<string, InsightState>>({});
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [asking, setAsking] = useState<{ questions: Question[]; answers: PartialAnswers; fresh: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/competitors`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(j.error ?? "Could not load the competitors"); return; }
      setLoadError("");
      setData(j as CompetitorsData);
    } catch {
      setLoadError("Could not load the competitors");
    }
  }, [opportunityId]);

  useEffect(() => { if (!initialData) void load(); }, [initialData, load]);

  const list = data?.competitors ?? [];
  const pending = data?.pending === true;
  const available = data?.insights.available === true;
  const stats = competitorStats(list);
  const shown = showAll ? list : list.slice(0, COMPETITOR_LIMITS.shown);
  const open = list.find((x) => x.id === openId) ?? null;

  async function send(url: string, init: RequestInit, failure: string): Promise<boolean> {
    onError("");
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? failure);
      return false;
    }
    return true;
  }

  const itemUrl = (x: CompetitorView) => `/api/opportunities/${opportunityId}/competitors/${x.id}`;

  async function toggleWinner(x: CompetitorView) {
    if (await send(itemUrl(x), { method: "PATCH", body: JSON.stringify({ is_winner: !x.is_winner }) }, "Could not save")) {
      await load();
      onChanged?.();
    }
  }

  async function answer(x: CompetitorView, status: "accepted" | "rejected") {
    setBusy(true);
    try {
      if (await send(itemUrl(x), { method: "PATCH", body: JSON.stringify({ status }) }, "Could not save")) {
        setOpenId(status === "rejected" ? null : x.id);
        onNotice?.(status === "accepted" ? `${x.name} added to this tender` : `${x.name} rejected`);
        await load();
        onChanged?.();
      }
    } finally { setBusy(false); }
  }

  async function remove(x: CompetitorView) {
    const yes = await confirm({ title: `Remove ${x.name}?`, body: "It is taken off this tender's list. An analysis already saved for the company stays in your workspace.", confirmLabel: "Remove", tone: "danger" });
    if (!yes) return;
    if (await send(itemUrl(x), { method: "DELETE" }, "Could not remove")) {
      setInsights((s) => { const { [x.id]: _gone, ...rest } = s; void _gone; return rest; });
      setOpenId(null);
      await load();
      onChanged?.();
    }
  }

  /** One analysis for the competitor whose panel is open. */
  async function runInsight(id: string, refresh: boolean) {
    setInsights((s) => ({ ...s, [id]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/competitors/${id}/insights`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.analysis) {
        setInsights((s) => ({ ...s, [id]: { status: "error", message: j.error ?? "The analysis is unavailable right now." } }));
        return;
      }
      setInsights((s) => ({ ...s, [id]: { status: "done", analysis: j.analysis as DockAnalysis, open: true } }));
    } catch {
      setInsights((s) => ({ ...s, [id]: { status: "error", message: "The analysis is unavailable right now." } }));
    }
  }

  /**
   * Market research. The server asks what it needs first (`needs`) and runs nothing until all three questions are answered; the answers
   * go back with each call, and the last call is the one that searches (about a minute). Proposals arrive as rows labelled Proposed.
   */
  async function suggest(answers: PartialAnswers, fresh: boolean) {
    onError("");
    setSearching(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/competitors/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers, fresh }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setAsking(null); onError(j.error ?? "The research could not run right now. Nothing was saved."); return; }
      if (Array.isArray(j.needs)) { setAsking({ questions: j.needs as Question[], answers, fresh }); return; }
      setAsking(null);
      onNotice?.(j.notice ?? `${j.proposed} ${j.proposed === 1 ? "competitor" : "competitors"} proposed. Open one to see its sources, then accept or reject it.`);
      await load();
      onChanged?.();
    } catch {
      setAsking(null);
      onError("The research could not run right now. Nothing was saved.");
    } finally { setSearching(false); }
  }

  function answerQuestion(key: Question["key"], value: string) {
    if (!asking) return;
    const answers = { ...asking.answers, [key]: value };
    const open = asking.questions.filter((q) => !answers[q.key]);
    if (open.length > 0) { setAsking({ ...asking, answers }); return; }
    void suggest(answers, asking.fresh);
  }

  const toggleInsights = (id: string) => setInsights((s) => {
    const cur = s[id];
    return cur?.status === "done" ? { ...s, [id]: { ...cur, open: !cur.open } } : s;
  });
  const goTo = (href: string) => { if (href.startsWith("/") && !href.startsWith("//")) router.push(href); };

  const summary = `${stats.total} on this tender${stats.cheaper > 0 ? ` · ${stats.cheaper} expected below us` : ""}${stats.proposed > 0 ? ` · ${stats.proposed} proposed` : ""}`;

  return (
    <div className="bpm-tap" data-guide="competitor.tab" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{css}</style>
      {pending && <div role="alert" data-guide="competitor.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>{PENDING}</div>}
      {loadError && <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{loadError}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Competitors</h2><InfoTip label="Competitors">{COMPETITOR_TIPS.tab}</InfoTip></span>
        {data && !pending && <span data-guide="competitor.summary" style={{ fontSize: 13, color: c.muted }}>{summary}</span>}
        {!pending && canEdit && (
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="secondary" size="sm" data-guide="competitor.add" style={{ minHeight: 44 }} onClick={() => setPanel({})}>Add competitor</Button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Button
                variant="primary" size="sm" loading={searching} disabled={!available || data?.researchPending === true || asking !== null} data-guide="competitor.suggest" style={{ minHeight: 44 }}
                onClick={() => void suggest({}, false)}
              >
                {searching ? "Searching…" : "Suggest from market research"}
              </Button>
              <InfoTip label="Suggest from market research">{!available && data?.insights.reason ? data.insights.reason : COMPETITOR_TIPS.suggest}</InfoTip>
            </span>
          </span>
        )}
      </div>

      {searching && <div role="status" data-guide="competitor.research.running" style={{ fontSize: 13, color: c.muted }}>Searching the public web. This takes about a minute; nothing is saved until you accept.</div>}
      {data?.researchPending === true && canEdit && !pending && <div data-guide="competitor.research.pending" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{PENDING_RESEARCH}</div>}
      {asking && <ResearchQuestions questions={asking.questions} answers={asking.answers} disabled={searching} onAnswer={answerQuestion} onCancel={() => setAsking(null)} />}
      {data?.research && !asking && !searching && (
        <div data-guide="competitor.research.assumes" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12.5, color: c.hint }}>
          <span>Research assumes: {assumesLine(data.research, null)}</span>
          <InfoTip label="Research assumes">{COMPETITOR_TIPS.assumes}</InfoTip>
          {canEdit && <Button variant="quiet" size="sm" data-guide="competitor.research.change" style={{ minHeight: 44 }} onClick={() => void suggest({}, true)}>Change</Button>}
        </div>
      )}

      {data === null && !loadError && <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading competitors…</div>}

      {data !== null && !pending && list.length === 0 && (
        <Card padding={0}>
          <EmptyState
            title="No competitors yet"
            text={canEdit ? "Add the companies you expect to bid against, or ask market research to suggest some. Their price position and strengths help the team price." : "No competitors have been added to this tender."}
            action={canEdit ? <Button variant="primary" style={{ minHeight: 44 }} onClick={() => setPanel({})}>Add competitor</Button> : undefined}
          />
        </Card>
      )}

      {shown.length > 0 && (
        <table className="cmp-table" data-guide="competitor.table">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Expected price</th>
              <th scope="col"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Status<InfoTip label="Status">{COMPETITOR_TIPS.status}</InfoTip></span></th>
              <th scope="col"><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.id} className="cmp-row" data-guide="competitor.row" data-competitor={x.id} onClick={() => setOpenId(x.id)}>
                <td className="cmp-name">
                  <button type="button" className="cmp-open" data-guide="competitor.open" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpenId(x.id); }}>
                    {x.name}
                    {x.is_winner && <span style={{ marginLeft: 8 }}><StatusPill label="Winner" tone={TONE_PILLAR.bad} /></span>}
                  </button>
                </td>
                <td className="cmp-price" style={{ fontSize: 13, color: c.ink }}>
                  {x.expected_price ? COMPETITOR_PRICE_LABEL[x.expected_price] : <StatusPill label="Unknown" tone="purple" />}
                </td>
                <td className="cmp-status"><StatusPill label={x.status === "proposed" ? "Proposed" : "Added by you"} tone={x.status === "proposed" ? "blue" : TONE_PILLAR.good} /></td>
                <td className="cmp-chev" aria-hidden="true">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.length > COMPETITOR_LIMITS.shown && (
        <div><Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${list.length}`}</Button></div>
      )}

      {open && !panel && (
        <CompetitorDetailPanel
          competitor={open} canEdit={canEdit} ourBid={data?.our_bid ?? null} insightsAvailable={available} insight={insights[open.id]} busy={busy}
          onClose={() => setOpenId(null)} onAccept={() => void answer(open, "accepted")} onReject={() => void answer(open, "rejected")}
          onEdit={() => setPanel({ competitor: open })} onToggleWinner={() => void toggleWinner(open)} onRemove={() => void remove(open)}
          onInsights={(refresh) => void runInsight(open.id, refresh)} onToggleInsights={() => toggleInsights(open.id)} onOpen={goTo} onAsk={(q) => askDock(q, null)}
        />
      )}
      {panel && (
        <CompetitorPanel
          opportunityId={opportunityId} competitor={panel.competitor} onClose={() => setPanel(null)}
          onSaved={async () => { const edited = !!panel.competitor; setPanel(null); onNotice?.(edited ? "Competitor saved" : "Competitor added"); await load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
