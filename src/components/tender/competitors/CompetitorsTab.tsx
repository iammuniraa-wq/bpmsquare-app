"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { useFeel } from "@/components/FeelProvider";
import { askDock } from "@/lib/analysis/dockAsk";
import { COMPETITOR_LIMITS, analyseAllSentence, competitorStats, type CompetitorView, type CompetitorsData } from "@/lib/tender/competitors/rules";
import { COMPETITOR_TIPS } from "@/lib/tender/competitors/tips";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";
import CompetitorCard, { type InsightState } from "./CompetitorCard";
import CompetitorPanel from "./CompetitorPanel";

// The Competitors tab of a tender deal (migration 0229): who we expect to bid against, what we know about each, and who won. A list of
// cards (one column on a phone, a grid on a desktop), a strip of three figures, "+ Add competitor" in the shared side panel, and on each
// card a Company insights button that runs the existing company analysis for that competitor only when it is pressed (it costs AI
// allowance). Edit access comes from the deal; the server decides again on every call.

const PENDING = "Competitors need a database update (migration 0229). Ask your administrator to apply it.";

export default function CompetitorsTab({ opportunityId, canEdit, onError, onNotice, onChanged, initialData, initialPanel = false }: {
  opportunityId: string;
  canEdit: boolean;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
  /** Called after a change that the rest of the page shows too (the winner is the deal's competitor). */
  onChanged?: () => void;
  /** Lets a server render (and its test) show the tab with its list. The page never passes it. */
  initialData?: CompetitorsData;
  initialPanel?: boolean;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [data, setData] = useState<CompetitorsData | null>(initialData ?? null);
  const [loadError, setLoadError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [panel, setPanel] = useState<{ competitor?: CompetitorView } | null>(initialPanel ? {} : null);
  const [insights, setInsights] = useState<Record<string, InsightState>>({});
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/competitors`);
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

  async function toggleWinner(x: CompetitorView) {
    if (await send(`/api/opportunities/${opportunityId}/competitors/${x.id}`, { method: "PATCH", body: JSON.stringify({ is_winner: !x.is_winner }) }, "Could not save")) {
      await load();
      onChanged?.();
    }
  }

  async function remove(x: CompetitorView) {
    const yes = await confirm({ title: `Remove ${x.name}?`, body: "It is taken off this tender's list. An analysis already saved for the company stays in your workspace.", confirmLabel: "Remove", tone: "danger" });
    if (!yes) return;
    if (await send(`/api/opportunities/${opportunityId}/competitors/${x.id}`, { method: "DELETE" }, "Could not remove")) {
      setInsights((s) => { const { [x.id]: _gone, ...rest } = s; void _gone; return rest; });
      await load();
      onChanged?.();
    }
  }

  /** One analysis. Returns false when the workspace should stop asking (a limit, or no access). */
  async function runInsight(id: string, refresh: boolean): Promise<boolean> {
    setInsights((s) => ({ ...s, [id]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/competitors/${id}/insights`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.analysis) {
        setInsights((s) => ({ ...s, [id]: { status: "error", message: j.error ?? "The analysis is unavailable right now." } }));
        return res.status !== 429 && res.status !== 403;
      }
      setInsights((s) => ({ ...s, [id]: { status: "done", analysis: j.analysis as DockAnalysis, open: true } }));
      return true;
    } catch {
      setInsights((s) => ({ ...s, [id]: { status: "error", message: "The analysis is unavailable right now." } }));
      return false;
    }
  }

  async function analyseAll() {
    const todo = list.filter((x) => insights[x.id]?.status !== "done");
    if (todo.length === 0) return;
    const yes = await confirm({ title: `Analyse ${todo.length} ${todo.length === 1 ? "competitor" : "competitors"}?`, body: analyseAllSentence(todo.length), confirmLabel: `Run ${todo.length}` });
    if (!yes) return;
    setBusyAll(true);
    try {
      for (const x of todo) {
        // One at a time: each call reserves its own slot against the daily limit.
        if (!(await runInsight(x.id, false))) break;
      }
    } finally { setBusyAll(false); }
  }

  const toggleInsights = (id: string) => setInsights((s) => {
    const cur = s[id];
    return cur?.status === "done" ? { ...s, [id]: { ...cur, open: !cur.open } } : s;
  });
  const open = (href: string) => { if (href.startsWith("/") && !href.startsWith("//")) router.push(href); };

  return (
    <div className="bpm-tap" data-guide="competitor.tab" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {pending && <div role="alert" data-guide="competitor.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>{PENDING}</div>}
      {loadError && <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{loadError}</div>}

      {!pending && (
        <StatStrip guide="competitor.strip">
          <StatTile tone="info" label="Competitors" value={String(stats.total)} sub={stats.total === 0 ? "none added yet" : "on this tender"} />
          <StatTile
            tone={stats.cheaper > 0 ? "warn" : "neutral"} label="Expect to be cheaper" info={COMPETITOR_TIPS.cheaper}
            value={String(stats.cheaper)} sub={stats.priced === 0 ? "no price view recorded" : `of ${stats.priced} with a price view`}
          />
          <StatTile tone={stats.winner ? "bad" : "neutral"} label="Winner" info={COMPETITOR_TIPS.winner} value={stats.winner ?? "Not decided"} sub={stats.winner ? "won this tender" : "mark one when the tender is decided"} />
        </StatStrip>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Competitors</h2><InfoTip label="Competitors">{COMPETITOR_TIPS.tab}</InfoTip></span>
        {data && !pending && !available && data.insights.reason && list.length > 0 && (
          <InfoTip label="Company insights">{data.insights.reason}</InfoTip>
        )}
        {!pending && (
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {available && list.length >= 2 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Button variant="secondary" size="sm" loading={busyAll} data-guide="competitor.analyse_all" style={{ minHeight: 44 }} onClick={analyseAll}>Analyse all</Button>
                <InfoTip label="Analyse all">{COMPETITOR_TIPS.insightsAll}</InfoTip>
              </span>
            )}
            {canEdit && !(data !== null && list.length === 0) && <Button variant="primary" size="sm" data-guide="competitor.add" style={{ minHeight: 44 }} onClick={() => setPanel({})}>+ Add competitor</Button>}
          </span>
        )}
      </div>

      {data === null && !loadError && <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading competitors…</div>}

      {data !== null && !pending && list.length === 0 && (
        <Card padding={0}>
          <EmptyState
            title="No competitors yet"
            text={canEdit ? "Add the companies you expect to bid against. Their price position and strengths help the team price." : "No competitors have been added to this tender."}
            action={canEdit ? <Button variant="primary" style={{ minHeight: 44 }} onClick={() => setPanel({})}>+ Add competitor</Button> : undefined}
          />
        </Card>
      )}

      {shown.length > 0 && (
        <div data-guide="competitor.list" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", alignItems: "start" }}>
          {shown.map((x) => (
            <CompetitorCard
              key={x.id} competitor={x} canEdit={canEdit} insightsAvailable={available} insight={insights[x.id]}
              onInsights={(refresh) => void runInsight(x.id, refresh)} onToggleInsights={() => toggleInsights(x.id)}
              onEdit={() => setPanel({ competitor: x })} onToggleWinner={() => void toggleWinner(x)} onRemove={() => void remove(x)}
              onOpen={open} onAsk={(q) => askDock(q, null)}
            />
          ))}
        </div>
      )}
      {list.length > COMPETITOR_LIMITS.shown && (
        <div><Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${list.length}`}</Button></div>
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
