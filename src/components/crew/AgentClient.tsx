"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { ROUTES } from "@/lib/constants";
import type { AgentEntry } from "@/lib/crew/registry";
import { CREW_TIPS } from "@/lib/crew/tips";
import type { CrewView } from "@/lib/crew/viewTypes";
import { LOGOS } from "./logos";
import RunsTable from "./RunsTable";
import ReviewList from "./ReviewList";
import SettingsPanel from "./SettingsPanel";
import s from "./crew.module.css";

// One agent's page: Review, Runs, Settings (design section 6), scoped to this agent. The tab and the page survive a reload and a shared link.

export default function AgentClient({ entry, view, canDigest }: { entry: AgentEntry; view: CrewView; canDigest: boolean }) {
  const router = useRouter();
  const st = view.settings[entry.key];
  const tile = view.tiles.find((t) => t.key === entry.key);
  const tabs = [
    { id: "review", label: "Review", count: view.findings.length },
    ...(view.runsVisible ? [{ id: "runs", label: "Runs" }] : []),
    { id: "settings", label: "Settings" },
  ];
  const [tab, setTab] = useUrlTab(tabs.map((t) => t.id));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const Logo = LOGOS[entry.logo];

  async function runNow() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/crew/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: entry.key }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg(r.ok ? "Started. It will appear under Runs in a few minutes." : j.error ?? "Could not start.");
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  const emptyText = tile?.status.key === "on" ? "Nothing needs your attention right now." : tile?.status.key === "off" ? "Switch the agent on under Settings to get suggestions." : undefined;

  return (
    <div className={s[`acc_${entry.accent}`]}>
      <Link href={ROUTES.aiAutomation} className={s.back}>← AI automation</Link>
      <div className={s.agentHead}>
        <span className={s.agentLogo}><Logo size={42} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{entry.name} <InfoTip label={entry.name}>{CREW_TIPS.page}</InfoTip></h1>
          <p className={s.purpose}>{entry.purpose}</p>
        </div>
        {tile && <span className={`${s.chip} ${s[`tone_${tile.status.tone}`]}`}><span className={s.dot} />{tile.status.label}</span>}
        {view.isAdmin && st?.enabled && !st.paused && !view.workspacePaused && (
          <button type="button" className={s.btn} onClick={runNow} disabled={busy} data-guide="crew.run_now">Run now</button>
        )}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, margin: "0 0 10px", color: "var(--muted)" }}>{msg}</div>}

      <Tabs tabs={tabs} value={tab} onChange={setTab} label={`${entry.name} sections`} />
      <div style={{ marginTop: 16 }}>
        {tab === "review" && (
          <ReviewList findings={view.findings} proposals={view.proposals} showAgent={false} empty={{ title: "Nothing to review", text: emptyText }} />
        )}
        {tab === "runs" && view.runsVisible && <RunsTable runs={view.runs} showAgent={false} />}
        {tab === "settings" && st && <SettingsPanel entry={entry} st={st} isAdmin={view.isAdmin} canDigest={canDigest} />}
      </div>
    </div>
  );
}
