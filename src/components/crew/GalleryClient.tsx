"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { COMING_SOON } from "@/lib/crew/registry";
import { CREW_TIPS } from "@/lib/crew/tips";
import type { CrewView } from "@/lib/crew/viewTypes";
import { AgentTile, SoonTile } from "./AgentTile";
import RunsTable from "./RunsTable";
import ReviewList from "./ReviewList";
import s from "./crew.module.css";

// The landing page of AI automation: a gallery of tiles, one per agent (the tile is data from the registry), plus the shared Review and Runs
// views across agents. "Pause all agents" sits in the header: it stops every agent between steps, and approving or rejecting a note still works.

export default function GalleryClient({ view }: { view: CrewView }) {
  const router = useRouter();
  const tabs = [
    { id: "agents", label: "Agents" },
    { id: "review", label: "Review", count: view.findings.length },
    ...(view.runsVisible ? [{ id: "runs", label: "Runs" }] : []),
  ];
  const [tab, setTab] = useUrlTab(tabs.map((t) => t.id));
  const [paused, setPaused] = useState(view.workspacePaused);
  const [err, setErr] = useState("");

  async function togglePause() {
    const next = !paused;
    setPaused(next); setErr("");
    const r = await fetch("/api/crew/settings/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: next }) });
    if (!r.ok) { setPaused(!next); setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not change that."); }
    else router.refresh();
  }

  return (
    <div>
      <div className={s.head}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="AI automation sections" />
        {view.isAdmin && !view.pending && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <button type="button" role="switch" aria-checked={paused} className={s.pause} onClick={togglePause} data-guide="crew.pause_all">
              <span className={`${s.track} ${paused ? s.trackOn : ""}`} /> Pause all agents
            </button>
            <InfoTip label="Pause all agents">{CREW_TIPS.pauseAll}</InfoTip>
          </div>
        )}
      </div>
      {(err || view.platformStopped) && (
        <div role="status" className={s.headNote} style={{ marginBottom: 10, color: "var(--amberink)" }}>{err || "Agents are stopped for the whole platform."}</div>
      )}

      {tab === "agents" && (
        <>
          {view.pending && (
            <div className={s.empty} style={{ marginBottom: 14 }} data-guide="crew.pending">
              <div className={s.emptyTitle}>AI automation needs a database update</div>
              <div style={{ marginTop: 6, fontSize: 13 }}>Ask your administrator to apply migration 0245.</div>
            </div>
          )}
          {view.tiles.length === 0 && !view.pending && (
            <div className={s.empty}><div className={s.emptyTitle}>No agents are available for your workspace yet</div></div>
          )}
          <div className={s.grid} data-guide="crew.gallery">
            {view.tiles.map((t) => <AgentTile key={t.key} t={t} />)}
          </div>
          <div className={s.section}>On the roadmap <InfoTip label="On the roadmap">{CREW_TIPS.comingSoon}</InfoTip></div>
          <div className={s.grid}>
            {COMING_SOON.map((c) => <SoonTile key={c.key} t={c} />)}
          </div>
        </>
      )}
      {tab === "review" && (
        <ReviewList findings={view.findings} proposals={view.proposals} showAgent empty={{ title: "Nothing to review", text: view.tiles.some((t) => t.status.key === "on") ? "Your agents have nothing for you right now." : "Switch an agent on to get suggestions." }} />
      )}
      {tab === "runs" && view.runsVisible && <RunsTable runs={view.runs} showAgent />}
    </div>
  );
}
