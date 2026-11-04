"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import { CREW_TIPS } from "@/lib/crew/tips";
import type { AgentEntry } from "@/lib/crew/registry";
import type { Sensitivity } from "@/lib/crew/types";
import type { AgentSettingsDTO } from "@/lib/crew/viewTypes";
import s from "./crew.module.css";

// The agent's settings: five rows and one "More" (design section 3.7, rule 6c: few options, good defaults). One sensitivity control stands in for
// several thresholds a workspace should never edit. Admin only to change; everyone who sees the agent may switch their own digest.

const DAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const;
const SENS: { id: Sensitivity; label: string }[] = [{ id: "quiet", label: "Quiet" }, { id: "balanced", label: "Balanced" }, { id: "thorough", label: "Thorough" }];

export default function SettingsPanel({ entry, st, isAdmin, canDigest }: { entry: AgentEntry; st: AgentSettingsDTO; isAdmin: boolean; canDigest: boolean }) {
  const router = useRouter();
  const sched = st.config.schedule ?? entry.defaults.schedule;
  const [enabled, setEnabled] = useState(st.enabled);
  const [time, setTime] = useState(sched.time);
  const [days, setDays] = useState<number[]>(sched.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [sens, setSens] = useState<Sensitivity>(st.config.sensitivity ?? entry.defaults.sensitivity);
  const [windowDays, setWindowDays] = useState(String(st.config.watch_window_days ?? 21));
  const [more, setMore] = useState(false);
  const [digest, setDigest] = useState(st.digestOn);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const tender = entry.key === "tender_watch";

  async function save() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/crew/settings/${entry.key}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, config: { schedule: { time, ...(days.length < 7 ? { days } : {}), ...(sched.weeklyDay !== undefined ? { weeklyDay: sched.weeklyDay } : {}) }, sensitivity: sens, ...(tender ? { watch_window_days: Number(windowDays) } : {}) } }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setMsg(j.error ?? "Could not save."); return; }
      setMsg("Saved."); router.refresh();
    } finally { setBusy(false); }
  }

  async function toggleDigest(on: boolean) {
    setDigest(on);
    const r = await fetch("/api/crew/digest", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: entry.key, on }) });
    if (!r.ok) setDigest(!on);
    else router.refresh();
  }

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]).sort());

  return (
    <div data-guide="crew.settings">
      <div className={s.setRow}>
        <div className={s.setLabel}>On <InfoTip label="On">{CREW_TIPS.onOff}</InfoTip></div>
        <div>
          <button type="button" role="switch" aria-checked={enabled} disabled={!isAdmin || (st.needsTimezone && !enabled)} className={s.pause} onClick={() => setEnabled((v) => !v)} data-guide="crew.settings.on">
            <span className={`${s.track} ${enabled ? s.trackOn : ""}`} /> {enabled ? "On" : "Off"}
          </button>
          {st.needsTimezone && <div className={s.headNote}>Set your time zone first (Settings, Workforce).</div>}
        </div>
      </div>

      <div className={s.setRow}>
        <div className={s.setLabel}>When <InfoTip label="When">{CREW_TIPS.when}</InfoTip></div>
        <div style={{ display: "grid", gap: 8 }}>
          <input className={s.field} type="time" value={time} disabled={!isAdmin} onChange={(e) => setTime(e.target.value)} aria-label="Time of day" style={{ maxWidth: 160 }} data-guide="crew.settings.time" />
          <div className={s.days} role="group" aria-label="Days">
            {DAYS.map(([label, d]) => <button key={d} type="button" disabled={!isAdmin} aria-pressed={days.includes(d)} className={`${s.day} ${days.includes(d) ? s.dayOn : ""}`} onClick={() => toggleDay(d)}>{label}</button>)}
          </div>
        </div>
      </div>

      <div className={s.setRow}>
        <div className={s.setLabel}>How sensitive <InfoTip label="How sensitive">{CREW_TIPS.sensitivity}</InfoTip></div>
        <div className={s.segment} role="group" aria-label="How sensitive" data-guide="crew.settings.sensitivity">
          {SENS.map((o) => <button key={o.id} type="button" disabled={!isAdmin} className={sens === o.id ? s.segOn : ""} aria-pressed={sens === o.id} onClick={() => setSens(o.id)}>{o.label}</button>)}
        </div>
      </div>

      {canDigest && (
        <div className={s.setRow}>
          <div className={s.setLabel}>My daily e-mail <InfoTip label="My daily e-mail">{CREW_TIPS.digest}</InfoTip></div>
          <button type="button" role="switch" aria-checked={digest} className={s.pause} onClick={() => toggleDigest(!digest)} data-guide="crew.settings.digest"><span className={`${s.track} ${digest ? s.trackOn : ""}`} /> {digest ? "On" : "Off"}</button>
        </div>
      )}

      <div className={s.setRow}>
        <div className={s.setLabel}>Allowance <InfoTip label="Allowance">{CREW_TIPS.allowance}</InfoTip></div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{st.used.toLocaleString("en-GB")} of {st.cap.toLocaleString("en-GB")} tokens this month ({st.percent}%)</div>
          <div className={s.meter}><span className={`${s.meterFill} ${st.percent >= 80 ? s.meterHot : ""}`} style={{ width: `${Math.max(2, st.percent)}%`, display: "block" }} /></div>
        </div>
      </div>

      {tender && (
        <div style={{ padding: "8px 0" }}>
          <button type="button" className={s.whyBtn} aria-expanded={more} onClick={() => setMore((v) => !v)} data-guide="crew.settings.more">{more ? "Fewer options" : "More options"}</button>
          {more && (
            <div className={s.setRow} style={{ borderBottom: 0 }}>
              <div className={s.setLabel}>Watch window <InfoTip label="Watch window">{CREW_TIPS.watchWindow}</InfoTip></div>
              <input className={s.field} inputMode="numeric" value={windowDays} disabled={!isAdmin} onChange={(e) => setWindowDays(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Watch window in days" style={{ maxWidth: 120 }} />
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className={s.actions} style={{ alignItems: "center" }}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={save} data-guide="crew.settings.save">Save</button>
          {msg && <span style={{ fontSize: 13, color: msg === "Saved." ? "var(--greenink)" : "var(--redink)" }} role="status">{msg}</span>}
        </div>
      )}
    </div>
  );
}
